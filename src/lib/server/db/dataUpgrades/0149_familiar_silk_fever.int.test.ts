/**
 * The 0149 data upgrade (★B): a user who had *Show all character fields* on
 * gets advanced controls on; one who did not stays off; a second run changes
 * nothing. Scratch table with the columns the upgrade touches, so the SQL is
 * what is under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { run } from "./0149_familiar_silk_fever"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const upgrade = (): Promise<void> => db.transaction(async (tx: any) => run(tx))
const rows = async () =>
	rawRows<{
		show_all_character_fields: boolean
		show_advanced_controls: boolean
	}>(
		await q(
			`SELECT show_all_character_fields, show_advanced_controls FROM user_settings ORDER BY id`
		)
	)

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(
		`CREATE TABLE user_settings (id serial PRIMARY KEY, show_all_character_fields boolean NOT NULL DEFAULT false, show_advanced_controls boolean NOT NULL DEFAULT false)`
	)
}, 60_000)

afterEach(async () => {
	vi.restoreAllMocks()
	await client.close()
})

describe("0149: advanced controls follow show-all-character-fields", () => {
	it("turns it on for a row with all fields shown, leaves the others off", async () => {
		await q(
			`INSERT INTO user_settings (show_all_character_fields) VALUES (true), (false)`
		)
		await upgrade()
		expect(await rows()).toEqual([
			{ show_all_character_fields: true, show_advanced_controls: true },
			{ show_all_character_fields: false, show_advanced_controls: false }
		])
	}, 60_000)

	it("a second run changes nothing and touches no row", async () => {
		await q(
			`INSERT INTO user_settings (show_all_character_fields) VALUES (true), (false)`
		)
		await upgrade()
		const first = await rows()
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		await upgrade()
		expect(await rows()).toEqual(first)
		expect(log).not.toHaveBeenCalled()
	}, 60_000)
})
