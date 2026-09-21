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
let roomSessionId: number
let roomUserId: number
let mainMessageId: number
let manuscriptMessageId: number

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

	/**
	 * A genre with a second channel that answers differently from the genre
	 * (R-C, 2026-09-17): the manuscript may not be deleted, and the genre's
	 * own `swipe: false` still holds there — declared keys win, the rest keep
	 * the genre's answer.
	 */
	await db.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.room:inlet/writing",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Writing Room" } },
		ports: {},
		sessionShape: {
			composer: "text",
			messageVerbs: { swipe: false },
			channels: [
				"main",
				{
					slug: "manuscript",
					role: "folio",
					voice: "none",
					messageVerbs: { delete: false }
				}
			]
		}
	} as any)

	const [room] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			genreId: "chariot.room:inlet/writing@1"
		})
		.returning()
	roomSessionId = room.id

	const [onMain] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: room.id,
			role: "user",
			content: "Make it colder.",
			channel: "main"
		})
		.returning()
	mainMessageId = onMain.id

	const [onManuscript] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: room.id,
			role: "assistant",
			content: "The gate was old.",
			channel: "manuscript"
		})
		.returning()
	manuscriptMessageId = onManuscript.id
	roomUserId = user.id
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

describe("a channel's own verbs (R-C)", () => {
	/**
	 * The override is per key and per message: the genre's declaration with
	 * the message's channel's over the top. A verb pressed with no `door`
	 * names no message, so it can only be asked of the genre — which is the
	 * honest answer, since there is no row to read a channel off.
	 */
	const door = (messageId: number) => ({ messageId, userId: roomUserId })

	it("switches delete off on the manuscript and leaves it on elsewhere", async () => {
		expect(
			await verbRefusal(db, roomSessionId, "delete", door(manuscriptMessageId))
		).toMatch(/does not offer delete/)
		expect(
			await verbRefusal(db, roomSessionId, "delete", door(mainMessageId))
		).toBeNull()
	})

	it("does not switch the genre's own refusals back on", async () => {
		// The channel declares `delete` and says nothing about `swipe`, so the
		// genre's `swipe: false` still holds on the manuscript.
		expect(
			await verbRefusal(db, roomSessionId, "swipe", door(manuscriptMessageId))
		).toMatch(/does not offer swipe/)
	})

	it("asked without a message, answers for the genre", async () => {
		expect(await verbRefusal(db, roomSessionId, "delete")).toBeNull()
		expect(await verbRefusal(db, roomSessionId, "swipe")).toMatch(
			/does not offer swipe/
		)
	})
})
