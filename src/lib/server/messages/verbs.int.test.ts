import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { resolveMessageVerbs, verbRefusal } from "./verbs"

/**
 * 20 §4: the mode declares availability, core refuses at the verb, and the
 * floors (delete/hide) are unrepresentable — nothing here can turn them off,
 * which is the enforcement, not a rule somebody checks.
 */

let db: TestDb
let hardcoreSessionId: number
let plainSessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "verbs-user")

	// A mode whose dice are final: no retry, no edit.
	await db.insert(schema.pipelineTypeRegistry).values({
		typeId: "chariot.dice:input/encounter",
		version: 1,
		kind: "input",
		status: "live",
		i18n: { name: { en: "Encounter" } },
		ports: {},
		sessionShape: {
			composer: "none",
			messageVerbs: { retry: false, edit: false }
		}
	} as any)

	const [hardcore] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			genreId: "chariot.dice:input/encounter@1"
		})
		.returning()
	hardcoreSessionId = hardcore.id

	const [plain] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	plainSessionId = plain.id
}, 60_000)

describe("resolveMessageVerbs", () => {
	it("absent means all on; declared false forbids; unknown keys ignored", () => {
		expect(resolveMessageVerbs(undefined)).toEqual({
			retry: true,
			continue: true,
			edit: true,
			stepBack: true
		})
		expect(
			resolveMessageVerbs({ messageVerbs: { retry: false } })
		).toMatchObject({ retry: false, continue: true, edit: true })
	})
})

describe("verbRefusal", () => {
	it("refuses a forbidden verb with the mode named, allows the rest", async () => {
		const retry = await verbRefusal(db, hardcoreSessionId, "retry")
		expect(retry).toMatch(/Encounter/)
		expect(retry).toMatch(/retry/)
		// The floors are always named in the refusal — deletion stays yours.
		expect(retry).toMatch(/Deleting or hiding is always yours/)
		expect(await verbRefusal(db, hardcoreSessionId, "continue")).toBeNull()
	})

	it("a session with no mode (or an unknown one) restricts nothing", async () => {
		expect(await verbRefusal(db, plainSessionId, "retry")).toBeNull()
		expect(await verbRefusal(db, 999999, "edit")).toBeNull()
	})
})
