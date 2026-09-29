/**
 * The `open-form` producer (PLAN-notifications §5) against real rows: a form
 * block stored as a `core:blocks` part on a session message, its staleness
 * computed from the channel head exactly as the fire door computes it.
 *
 * Pinned:
 *  1. A form put to a person raises for that person; a form put to nobody
 *     raises for the session owner; a form already overtaken raises nothing.
 *  2. Answered → cleared `acted` (the fire door's clear, and the re-check's).
 *  3. A later line on the channel → cleared `superseded`.
 *  4. The message deleted → cleared `superseded`.
 *  5. Still open — an answer row to the form does not move its head — is
 *     left alone.
 *  6. The boot re-check settles every open row, across sessions.
 *  7. The session-event listener: a `message-deleted` emit settles the rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
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

import {
	clearAnsweredForm,
	formStandingOf,
	raiseOpenForms,
	recheckOpenForms,
	settleOpenForms
} from "./openForm"
import { OPEN_FORM, regardingFor } from "$lib/shared/notifications/kinds"

let testDb: TestDb
let db: Db
let ownerId: number
let guestId: number

beforeAll(async () => {
	const { createTestDb, createTestUser } = await import("$lib/server/utils/testDb")
	testDb = await createTestDb()
	db = testDb as unknown as Db
	setDb(testDb)
	ownerId = (await createTestUser(testDb, "open-form-owner")).id
	guestId = (await createTestUser(testDb, "open-form-guest")).id
}, 60_000)

afterAll(async () => {
	await (testDb as any)?.$client?.close?.()
})

async function makeSession(name = "The Sunken Vault") {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: true, name })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guestId })
	return session!.id
}

/** A row carrying one `choices` form, issued at its own id as the head. */
async function formRow(sessionId: number, blockId = "knock") {
	const { insertLegacy, appendParts } = await import("$lib/server/messages/store")
	const row = await insertLegacy(db, {
		sessionId,
		role: "assistant",
		content: "Is there a room here?"
	})
	await appendParts(db, row.id, [
		{
			type: "core:blocks",
			data: {
				blocks: [
					{
						kind: "choices",
						id: blockId,
						head: row.id,
						question: "Is there a room here?",
						actions: [
							{ fn: "room", action: "x#room", label: "Build it", choice: "build" },
							{ fn: "room", action: "x#room", label: "Improvise", choice: "improvise" }
						]
					}
				]
			}
		}
	] as any)
	return row.id
}

async function line(sessionId: number, metadata?: Record<string, unknown>) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return (
		await insertLegacy(db, {
			sessionId,
			role: "user",
			content: "Onward.",
			...(metadata ? { metadata } : {})
		} as any)
	).id
}

async function rowsFor(sessionId: number, messageId: number, blockId = "knock") {
	return await testDb
		.select()
		.from(schema.notifications)
		.where(
			eq(
				schema.notifications.regarding,
				regardingFor.form(sessionId, messageId, blockId)
			)
		)
		.orderBy(schema.notifications.id)
}

describe("open-form notifications (PGlite integration)", () => {
	it("raises for the person, the owner when nobody, and not for an overtaken form", async () => {
		const s = await makeSession()
		const put = await formRow(s, "to-guest")
		await raiseOpenForms(db, s, [{ messageId: put, blockId: "to-guest", userId: guestId }])
		const [guestRow] = await rowsFor(s, put, "to-guest")
		expect(guestRow).toMatchObject({
			userId: guestId,
			kind: OPEN_FORM.id,
			level: "attention",
			href: `/sessions/${s}?message=${put}&block=to-guest`,
			vars: { session: "The Sunken Vault" },
			clearedAt: null
		})

		const sn = await makeSession()
		const nobody = await formRow(sn, "to-nobody")
		await raiseOpenForms(db, sn, [{ messageId: nobody, blockId: "to-nobody", userId: null }])
		expect(await rowsFor(sn, nobody, "to-nobody")).toMatchObject([
			{ userId: ownerId, clearedAt: null }
		])

		// A form a later line already overtook raises nothing.
		const s2 = await makeSession()
		const old = await formRow(s2)
		await line(s2)
		await raiseOpenForms(db, s2, [{ messageId: old, blockId: "knock", userId: guestId }])
		expect(await rowsFor(s2, old)).toHaveLength(0)
	}, 60_000)

	it("answered → cleared acted, by the fire door and by the re-check", async () => {
		const { markFormAnswered } = await import("$lib/server/messages/blocks")
		const s = await makeSession()
		const a = await formRow(s, "a")
		const b = await formRow(s, "b")
		await raiseOpenForms(db, s, [
			{ messageId: b, blockId: "b", userId: guestId },
			{ messageId: a, blockId: "a", userId: guestId }
		])
		// `a` is overtaken by `b` before it is raised, so only `b` has a row.
		expect(await rowsFor(s, a, "a")).toHaveLength(0)
		await markFormAnswered(db, b, "b", { by: `user:${guestId}`, at: new Date().toISOString() })
		await clearAnsweredForm(db, s, b, "b")
		expect(await rowsFor(s, b, "b")).toMatchObject([{ clearedHow: "acted" }])

		const c = await formRow(s, "c")
		await raiseOpenForms(db, s, [{ messageId: c, blockId: "c", userId: guestId }])
		await markFormAnswered(db, c, "c", { by: `user:${guestId}`, at: new Date().toISOString() })
		await settleOpenForms(db, s)
		expect(await rowsFor(s, c, "c")).toMatchObject([{ clearedHow: "acted" }])
	}, 60_000)

	it("a later line → superseded; an answer row to the form → untouched", async () => {
		const s = await makeSession()
		const m = await formRow(s)
		await raiseOpenForms(db, s, [{ messageId: m, blockId: "knock", userId: guestId }])

		// The answer to this row's own form does not move its head.
		await line(s, { answersForm: { messageId: m, blockId: "knock" } })
		await settleOpenForms(db, s)
		expect(await formStandingOf(db, s, m, "knock")).toBe("open")
		expect(await rowsFor(s, m)).toMatchObject([{ clearedAt: null }])

		await line(s)
		expect(await formStandingOf(db, s, m, "knock")).toBe("stale")
		await settleOpenForms(db, s)
		const [row] = await rowsFor(s, m)
		expect(row).toMatchObject({ clearedHow: "superseded" })
		expect(row!.clearedAt).not.toBeNull()
	}, 60_000)

	it("the message deleted → superseded", async () => {
		const { deleteLegacy } = await import("$lib/server/messages/store")
		const s = await makeSession()
		const m = await formRow(s)
		await raiseOpenForms(db, s, [{ messageId: m, blockId: "knock", userId: null }])
		expect(await rowsFor(s, m)).toMatchObject([{ userId: ownerId, clearedAt: null }])
		await deleteLegacy(db, m)
		expect(await formStandingOf(db, s, m, "knock")).toBe("gone")
		await settleOpenForms(db, s)
		expect(await rowsFor(s, m)).toMatchObject([{ clearedHow: "superseded" }])
	}, 60_000)

	it("the boot re-check settles every open row and leaves the open ones", async () => {
		const s1 = await makeSession()
		const s2 = await makeSession()
		const stale = await formRow(s1)
		const open = await formRow(s2)
		await raiseOpenForms(db, s1, [{ messageId: stale, blockId: "knock", userId: guestId }])
		await raiseOpenForms(db, s2, [{ messageId: open, blockId: "knock", userId: guestId }])
		await line(s1)
		await recheckOpenForms(db)
		expect(await rowsFor(s1, stale)).toMatchObject([{ clearedHow: "superseded" }])
		expect(await rowsFor(s2, open)).toMatchObject([{ clearedAt: null }])
	}, 60_000)

	it("a message-deleted session event settles the session's rows", async () => {
		const { deleteLegacy } = await import("$lib/server/messages/store")
		const { emitSessionEvent, settleSessionEvents } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const s = await makeSession()
		const m = await formRow(s)
		await raiseOpenForms(db, s, [{ messageId: m, blockId: "knock", userId: guestId }])
		await deleteLegacy(db, m)
		await emitSessionEvent(db, {
			sessionId: s,
			userId: ownerId,
			event: "core:event/message-deleted@1",
			payload: { sessionId: s, messageId: m, cause: { kind: "user", userId: ownerId } }
		})
		await settleSessionEvents(s)
		expect(await rowsFor(s, m)).toMatchObject([{ clearedHow: "superseded" }])
	}, 60_000)
})
