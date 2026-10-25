/**
 * The 0128 data upgrade (pr-6s2 C4): core's four runtime keys move from
 * `sessions.metadata` into the `core` annex document, the branch marker onto
 * its three columns. Scratch table with the columns the upgrade touches, so
 * the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { moveCoreRuntimeKeys } from "./0128_pr6s2_core_annex"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))
const upgrade = () => db.transaction(async (tx: any) => moveCoreRuntimeKeys(tx))
const all = () => rows<any>(`SELECT * FROM sessions ORDER BY id`)

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(
		`CREATE TABLE sessions (id serial PRIMARY KEY, metadata json NOT NULL DEFAULT '{}', annex jsonb NOT NULL DEFAULT '{}', branch_of_session_id integer, branch_of_message_id integer, branch_of_name text)`
	)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const insert = (id: number, metadata: unknown, annex: unknown = {}) =>
	q(`INSERT INTO sessions (id, metadata, annex) VALUES (${id}, '${JSON.stringify(metadata)}', '${JSON.stringify(annex)}')`)

describe("0128 core annex: runtime keys onto owner core, branch marker onto columns", () => {
	it("moves the four keys verbatim, keeps the settings and every other owner, sets the columns", async () => {
		const turnOrder = { v: 1, order: [{ ref: "user:1", channel: "main" }], runId: null, event: null, strategy: null, basedOnAt: 5 }
		const turnTally = { v: 1, lanes: { main: { turn: 3, lastSpeaker: "user:1", turnsBy: { "user:1": 1 }, spoke: [], persons: [] } } }
		const laneReads = { "1": { main: 12 } }
		const rulesetDecks = { tarot: { scene: null, shuffle: 1, drawn: 2 } }
		const branchOf = { sessionId: 4, messageId: 9, name: "Crawl Six" }
		await insert(
			1,
			{ playerLabel: "Hero", scenes: { a: 1 }, turnOrder, turnTally, laneReads, rulesetDecks, branchOf },
			{ core: { "retake-quietly": true }, acme: { x: 1 } }
		)
		await upgrade()
		const [row] = await all()
		expect(row.metadata).toEqual({ playerLabel: "Hero", scenes: { a: 1 } })
		expect(row.annex.core).toEqual({ "retake-quietly": true, turnOrder, turnTally, laneReads, rulesetDecks })
		expect("runId" in row.annex.core.turnOrder && row.annex.core.turnOrder.runId === null).toBe(true)
		expect(row.annex.core.turnOrder.event).toBeNull()
		expect(row.annex.core.turnOrder.strategy).toBeNull()
		expect(row.annex.acme).toEqual({ x: 1 })
		expect([row.branch_of_session_id, row.branch_of_message_id, row.branch_of_name]).toEqual([4, 9, "Crawl Six"])
	})

	it("a malformed branchOf leaves the columns null and still leaves metadata", async () => {
		await insert(1, { playerLabel: "Hero", branchOf: { sessionId: "x" } })
		await upgrade()
		const [row] = await all()
		expect([row.branch_of_session_id, row.branch_of_message_id, row.branch_of_name]).toEqual([null, null, null])
		expect(row.metadata).toEqual({ playerLabel: "Hero" })
		expect(row.annex).toEqual({})
	})

	it("a session with none of the keys is unchanged", async () => {
		await insert(1, { playerLabel: "Hero", scenes: [] }, { core: { "retake-quietly": false } })
		const before = await all()
		await upgrade()
		expect(await all()).toEqual(before)
	})

	it("a second run changes nothing", async () => {
		await insert(1, { turnOrder: { v: 1, order: [], runId: null }, laneReads: { "2": { main: 1 } }, branchOf: { sessionId: 1, messageId: 2, name: null } })
		await insert(2, { playerLabel: "x" })
		await upgrade()
		const once = await all()
		await upgrade()
		expect(await all()).toEqual(once)
	})
})
