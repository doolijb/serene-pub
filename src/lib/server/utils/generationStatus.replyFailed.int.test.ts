/**
 * The `reply-failed` notification (PLAN-notifications §5): raised by the ONE
 * call of `persistGenerationErrorRow` that actually fails the row — the fenced
 * update's result is the once-only fact — and superseded when the message is
 * regenerated, swiped or deleted (`clearReplyFailed`, which those handlers
 * call).
 *
 * `$lib/server/db` is replaced by a real migrated test database behind a
 * getter; `pushToUser` is a spy so pushes can be asserted without sockets.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const { getDb, setDb, pushSpy } = vi.hoisted(() => {
	let current: unknown
	return {
		getDb: () => current,
		setDb: (db: unknown) => {
			current = db
		},
		pushSpy: vi.fn()
	}
})

vi.mock("$lib/server/db", () => ({
	get db() {
		return getDb()
	}
}))

vi.mock("$lib/server/sockets/utils/userPush", () => ({
	pushToUser: pushSpy
}))

import { clearReplyFailed, persistGenerationErrorRow } from "./generationStatus"
import { ComposedError } from "$lib/server/connections/visibility"
import {
	REPLY_FAILED,
	regardingFor,
	sessionHref
} from "$lib/shared/notifications/kinds"

const N = schema.notifications
let testDb: TestDb

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	testDb = await createTestDb()
	setDb(testDb)
}, 60_000)

afterAll(async () => {
	await (testDb as any)?.$client?.close?.()
})

beforeEach(() => {
	pushSpy.mockClear()
})

async function scenario(tag: string, name: string | null = "Harbour Night") {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `${tag}-presser`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, name, isGroup: false } as any)
		.returning()
	const [message] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "assistant",
			isGenerating: true,
			content: ""
		})
		.returning()
	return { user, session, message }
}

function rowsOf(userId: number) {
	return testDb.select().from(N).where(eq(N.userId, userId)).orderBy(N.id)
}

function openRowsOf(userId: number) {
	return testDb
		.select()
		.from(N)
		.where(and(eq(N.userId, userId), isNull(N.clearedAt)))
}

describe("reply-failed", () => {
	test("is raised once, by the call that failed the row, and never by a second", async () => {
		const { user, session, message } = await scenario("once")

		await persistGenerationErrorRow(
			null,
			session.id,
			message.id,
			new ComposedError("The model returned nothing."),
			{ userId: user.id }
		)

		const [row, ...rest] = await rowsOf(user.id)
		expect(rest).toEqual([])
		expect(row.kind).toBe(REPLY_FAILED.id)
		expect(row.regarding).toBe(
			regardingFor.replyFailed(session.id, message.id)
		)
		expect(row.href).toBe(sessionHref(session.id, message.id))
		expect(row.vars).toEqual({
			session: "Harbour Night",
			error: "The model returned nothing."
		})
		expect(row.clearedAt).toBeNull()
		expect(pushSpy).toHaveBeenCalled()

		// The row is no longer generating, so the fence lets nothing through:
		// no second raise, no bump of the first.
		pushSpy.mockClear()
		const before = row.lastRaisedAt.getTime()
		await persistGenerationErrorRow(
			null,
			session.id,
			message.id,
			new ComposedError("A second, late failure."),
			{ userId: user.id }
		)
		const after = await rowsOf(user.id)
		expect(after).toHaveLength(1)
		expect(after[0].lastRaisedAt.getTime()).toBe(before)
		expect(after[0].vars).toEqual(row.vars)
		expect(pushSpy).not.toHaveBeenCalled()
	}, 60_000)

	test("says only what the row says, truncated, and names an untitled session", async () => {
		const { user, session, message } = await scenario("opaque", null)

		await persistGenerationErrorRow(
			null,
			session.id,
			message.id,
			// A service's words: moved off the row's message, so off the
			// notification too.
			new Error("upstream at http://10.0.0.4:5001 said " + "x".repeat(400)),
			{ userId: user.id }
		)

		const [row] = await rowsOf(user.id)
		const vars = row.vars as Record<string, string>
		expect(vars.session).toBe("Untitled session")
		expect(vars.error).not.toContain("10.0.0.4")
		expect(vars.error).toMatch(/administrator/i)
		expect(vars.error.length).toBeLessThanOrEqual(160)

		const long = await scenario("long")
		await persistGenerationErrorRow(
			null,
			long.session.id,
			long.message.id,
			new ComposedError("y".repeat(400)),
			{ userId: long.user.id }
		)
		const [longRow] = await rowsOf(long.user.id)
		const text = (longRow.vars as Record<string, string>).error
		expect(text.length).toBe(160)
		expect(text.endsWith("…")).toBe(true)
	}, 60_000)

	test("raises nothing when no presser is known", async () => {
		const { user, session, message } = await scenario("nobody")

		await persistGenerationErrorRow(
			null,
			session.id,
			message.id,
			new ComposedError("No one asked.")
		)

		const [failed] = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, message.id))
		expect(failed.isGenerating).toBe(false)
		expect(await rowsOf(user.id)).toEqual([])
	}, 60_000)

	test("is superseded by a regenerate/swipe/delete of the message, and a later failure raises afresh", async () => {
		const { user, session, message } = await scenario("superseded")
		const other = await scenario("superseded-other")

		await persistGenerationErrorRow(
			null,
			session.id,
			message.id,
			new ComposedError("First failure."),
			{ userId: user.id }
		)
		await persistGenerationErrorRow(
			null,
			other.session.id,
			other.message.id,
			new ComposedError("Unrelated failure."),
			{ userId: other.user.id }
		)
		expect(await openRowsOf(user.id)).toHaveLength(1)

		pushSpy.mockClear()
		await clearReplyFailed(session.id, message.id)

		const [cleared] = await rowsOf(user.id)
		expect(cleared.clearedHow).toBe("superseded")
		expect(cleared.clearedAt).not.toBeNull()
		expect(pushSpy).toHaveBeenCalled()
		// Another message's failure is untouched.
		expect(await openRowsOf(other.user.id)).toHaveLength(1)

		// The regenerate reopens the row; its own failure is a new notification.
		await testDb
			.update(schema.sessionMessages)
			.set({ isGenerating: true, error: null })
			.where(eq(schema.sessionMessages.id, message.id))
		await persistGenerationErrorRow(
			null,
			session.id,
			message.id,
			new ComposedError("Second failure."),
			{ userId: user.id }
		)
		const open = await openRowsOf(user.id)
		expect(open).toHaveLength(1)
		expect((open[0].vars as Record<string, string>).error).toBe(
			"Second failure."
		)
		expect(await rowsOf(user.id)).toHaveLength(2)
	}, 60_000)
})
