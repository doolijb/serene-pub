import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { resolveMessageVerbs, verbRefusal } from "./verbs"

/**
 * 20 §4 / R-15: the genre declares availability, core refuses at the verb,
 * and the floors (stop, branch, edit) are unrepresentable — nothing here can
 * turn them off, which is the enforcement, not a rule somebody checks. The
 * opt-in built-ins (delete, hide, swipe) and the content actions (retry,
 * continue, stepBack) are the forbiddable set.
 */

let db: TestDb
let hardcoreSessionId: number
let plainSessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "verbs-user")

	// A genre whose dice are final: no retry, no delete, no swipe.
	await db.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.dice:inlet/encounter",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Encounter" } },
		ports: {},
		sessionShape: {
			composer: "none",
			messageVerbs: { retry: false, delete: false, swipe: false }
		}
	} as any)

	const [hardcore] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			genreId: "chariot.dice:inlet/encounter@1"
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
			stepBack: true,
			delete: true,
			hide: true,
			swipe: true
		})
		expect(
			resolveMessageVerbs({ messageVerbs: { retry: false, hide: false } })
		).toMatchObject({ retry: false, continue: true, hide: false, delete: true })
	})

	it("the floors are not in the map: a stored `edit: false` is ignored, not honoured", () => {
		// A row written before the ruling, or by hand: the reader has no key
		// for a floor, so nothing downstream can read it as forbidden.
		const policy = resolveMessageVerbs({
			messageVerbs: { edit: false, branch: false, stop: false }
		}) as Record<string, unknown>
		expect(policy).not.toHaveProperty("edit")
		expect(policy).not.toHaveProperty("branch")
		expect(policy).not.toHaveProperty("stop")
	})
})

describe("verbRefusal", () => {
	it("refuses a forbidden verb with the genre named, allows the rest", async () => {
		const retry = await verbRefusal(db, hardcoreSessionId, "retry")
		expect(retry).toMatch(/Encounter/)
		expect(retry).toMatch(/retry/)
		// The floors are always named in the refusal.
		expect(retry).toMatch(/Stopping, branching and editing are always yours/)
		expect(await verbRefusal(db, hardcoreSessionId, "continue")).toBeNull()
	})

	it("an opt-in built-in switched off is refused; one left on is not", async () => {
		expect(await verbRefusal(db, hardcoreSessionId, "delete")).toMatch(
			/does not offer delete/
		)
		expect(await verbRefusal(db, hardcoreSessionId, "swipe")).toMatch(
			/does not offer swipe/
		)
		expect(await verbRefusal(db, hardcoreSessionId, "hide")).toBeNull()
	})

	it("a session with no mode (or an unknown one) restricts nothing", async () => {
		expect(await verbRefusal(db, plainSessionId, "retry")).toBeNull()
		expect(await verbRefusal(db, 999999, "delete")).toBeNull()
	})
})
