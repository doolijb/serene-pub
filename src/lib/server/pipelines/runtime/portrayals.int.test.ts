/**
 * Who portrays X this turn — the resolver's table, against real rows
 * (plans/29 R-15 *audience*, R-21 (4); U5a).
 *
 * One session: an owner, one guest, one cast character (the owner's), one
 * member-presence character (the guest's own persona, attached through
 * `session_personas`), and beside it a person who is not a member and a
 * character that is in nobody's session. Every row of the docblock table in
 * `portrayals.ts` is asserted here with those rows and nothing mocked.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { participantRowId, resolvePortrayals, turnRefs } from "./portrayals"

let db: TestDb
let sessionId: number
let ownerId: number
let guestId: number
let adminId: number
let strangerId: number
/** The owner's library character, seated in the cast. */
let castId: number
/** The guest's own persona, attached as their presence in the session. */
let presenceId: number
/** A library character in nobody's session. */
let absentId: number
/** A cast row soft-removed from the session. */
let removedId: number
/** A persona row whose owner has since left the session. */
let orphanPresenceId: number

const person = (userId: number) => ({ by: "person", userId: String(userId) })

beforeAll(async () => {
	db = await createTestDb()
	const user = async (username: string, isAdmin = false) =>
		(
			await db
				.insert(schema.users)
				.values({ username, isAdmin })
				.returning()
		)[0]!.id
	ownerId = await user("portrayals-owner")
	guestId = await user("portrayals-guest")
	adminId = await user("portrayals-admin", true)
	strangerId = await user("portrayals-stranger")
	const leaverId = await user("portrayals-leaver")

	const character = async (
		userId: number,
		name: string,
		isPersona = false
	) =>
		(
			await db
				.insert(schema.characters)
				.values({ userId, name, description: name, isPersona })
				.returning()
		)[0]!.id
	castId = await character(ownerId, "Tom")
	presenceId = await character(guestId, "Elara", true)
	absentId = await character(ownerId, "Nobody Here")
	removedId = await character(ownerId, "Departed")
	orphanPresenceId = await character(leaverId, "Left Behind", true)

	sessionId = (
		await db
			.insert(schema.sessions)
			.values({ userId: ownerId, isGroup: true })
			.returning()
	)[0]!.id
	await db
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: guestId })
	await db.insert(schema.sessionCharacters).values([
		{ sessionId, characterId: castId, isActive: true, visibility: "visible" },
		{
			sessionId,
			characterId: removedId,
			isActive: true,
			visibility: "visible",
			removedAt: new Date(),
			removedName: "Departed"
		}
	])
	await db.insert(schema.sessionPersonas).values([
		{ sessionId, personaId: presenceId },
		{ sessionId, personaId: orphanPresenceId }
	])
}, 60_000)

describe("resolvePortrayals — the table", () => {
	const resolve = (
		refs: string[],
		runOwnerUserId = ownerId,
		speaker: string | null = null
	) =>
		resolvePortrayals(db as any, {
			sessionId,
			runOwnerUserId,
			refs: refs as any,
			speaker: speaker as any
		})

	it("user:<id> — a member is a person; anybody else is nobody", async () => {
		const v = await resolve([
			`user:${ownerId}`,
			`user:${guestId}`,
			`user:${strangerId}`,
			`user:${adminId}`
		])
		expect(v[`user:${ownerId}`]).toEqual(person(ownerId))
		expect(v[`user:${guestId}`]).toEqual(person(guestId))
		// Not a member, whoever they are — an administrator included.
		expect(v[`user:${strangerId}`]).toEqual({ by: "none" })
		expect(v[`user:${adminId}`]).toEqual({ by: "none" })
	})

	it("owner is the session's owner, whoever started the run", async () => {
		expect((await resolve(["owner"], guestId)).owner).toEqual(person(ownerId))
		expect((await resolve(["owner"], strangerId)).owner).toEqual(person(ownerId))
	})

	it("admin is the run owner when they are one, else nobody", async () => {
		expect((await resolve(["admin"], adminId)).admin).toEqual(person(adminId))
		expect((await resolve(["admin"], ownerId)).admin).toEqual({ by: "none" })
	})

	it("participant is the run owner when they are a member, else nobody", async () => {
		expect((await resolve(["participant"], ownerId)).participant).toEqual(person(ownerId))
		expect((await resolve(["participant"], guestId)).participant).toEqual(person(guestId))
		expect((await resolve(["participant"], strangerId)).participant).toEqual({ by: "none" })
	})

	it("run-owner is the run owner, always", async () => {
		expect((await resolve(["run-owner"], strangerId))["run-owner"]).toEqual(person(strangerId))
	})

	it("character:<id> — a member's own presence is that person; the cast is the AI; anyone else is nobody", async () => {
		const v = await resolve([
			`character:${presenceId}`,
			`character:${castId}`,
			`character:${absentId}`,
			`character:${removedId}`,
			`character:${orphanPresenceId}`,
			"character:999999",
			"character:not-a-row"
		])
		// Keyed on: a live `session_personas` row for the character whose
		// `characters.user_id` is a session member (the guest).
		expect(v[`character:${presenceId}`]).toEqual(person(guestId))
		// A live `session_characters` row, and no member portraying it.
		expect(v[`character:${castId}`]).toEqual({ by: "ai" })
		// In the library, in no session.
		expect(v[`character:${absentId}`]).toEqual({ by: "none" })
		// Soft-removed from the cast: a departed member is nobody's.
		expect(v[`character:${removedId}`]).toEqual({ by: "none" })
		// A persona row whose owner is no longer a member, and no cast row.
		expect(v[`character:${orphanPresenceId}`]).toEqual({ by: "none" })
		expect(v["character:999999"]).toEqual({ by: "none" })
		// An id the host cannot read is nobody's, and reaches no query.
		expect(v["character:not-a-row"]).toEqual({ by: "none" })
	})

	it("an id no integer column holds is nobody's, never a thrown query (S1)", async () => {
		// Past Postgres `integer`, past `Number.MAX_SAFE_INTEGER`, and a
		// digit string that is not a number at all once parsed: each is a
		// reference to no row, answered rather than surfaced as a driver
		// error from a query the resolver never needed to send.
		const v = await resolve([
			"character:2147483648",
			"user:2147483648",
			"character:99999999999999999999",
			"user:99999999999999999999",
			"character:2147483647"
		])
		expect(v["character:2147483648"]).toEqual({ by: "none" })
		expect(v["user:2147483648"]).toEqual({ by: "none" })
		expect(v["character:99999999999999999999"]).toEqual({ by: "none" })
		expect(v["user:99999999999999999999"]).toEqual({ by: "none" })
		// The column's ceiling itself is a readable id — merely absent.
		expect(v["character:2147483647"]).toEqual({ by: "none" })
		expect(participantRowId("2147483647")).toBe(2147483647)
		expect(participantRowId("2147483648")).toBe(null)
		expect(participantRowId("007")).toBeNull()
		expect(participantRowId("0")).toBeNull()
		expect(participantRowId("-1")).toBe(null)
		expect(participantRowId("1e3")).toBe(null)
	})

	it("the turn's speaker is the AI's when no presence portrays them — a side character, cast row or not (W3)", async () => {
		// Not in the cast, not anybody's presence: nobody's when merely
		// asked about, the model's when the run is theirs to speak.
		expect(
			(await resolve([`character:${absentId}`]))[`character:${absentId}`]
		).toEqual({ by: "none" })
		const asSpeaker = await resolve(
			[`character:${absentId}`],
			ownerId,
			`character:${absentId}`
		)
		expect(asSpeaker[`character:${absentId}`]).toEqual({ by: "ai" })
		// A removed cast member coming back for one scene is the same case.
		const returning = await resolve(
			[`character:${removedId}`],
			ownerId,
			` character:${removedId} `
		)
		expect(returning[`character:${removedId}`]).toEqual({ by: "ai" })
		// A member's own presence stays that person's even as the speaker —
		// which is why the reply road never seats a presence as one.
		const presence = await resolve(
			[`character:${presenceId}`],
			ownerId,
			`character:${presenceId}`
		)
		expect(presence[`character:${presenceId}`]).toEqual(person(guestId))
		// An unreadable id is nobody's, speaker or not.
		const junk = await resolve(["character:not-a-row"], ownerId, "character:not-a-row")
		expect(junk["character:not-a-row"]).toEqual({ by: "none" })
	})

	it("envoy:<slug> — nobody's unless the session's genre or an installed action declares it (U5g)", async () => {
		// A standard chat session declares no envoys, and no action here
		// contributes one: both slugs are references nobody holds. The
		// declared case — `ai`, seated or not — is pinned against the guide
		// genre in `utils/envoyRoad.int.test.ts`.
		const v = await resolve(["envoy:mascot", "envoy:chariot.dice-tray.master"])
		expect(v["envoy:mascot"]).toEqual({ by: "none" })
		expect(v["envoy:chariot.dice-tray.master"]).toEqual({ by: "none" })
	})

	it("item — nobody, without a message to decide it against", async () => {
		expect((await resolve(["item"])).item).toEqual({ by: "none" })
	})

	it("answers a reference once, under its canonical spelling", async () => {
		const v = await resolve(["owner", " owner ", `character:${castId}`, `character:${castId}`])
		expect(Object.keys(v).sort()).toEqual(["owner", `character:${castId}`].sort())
	})

	it("refuses a malformed reference where the author is", async () => {
		await expect(resolve(["persona:3"])).rejects.toThrow(/not a kind/)
	})

	it("turnRefs asks about the speaker, the live cast, the live presences, the owner and the run owner", async () => {
		const refs = await turnRefs(db as any, sessionId, `character:${castId}`)
		// Both persona rows are live presences and are asked about — the
		// guest's, and the leaver's, which the resolver then answers `none`.
		// A guest's presence is in the session without being in the cast,
		// and without this the line could never say "Elara · you" (W4).
		expect(refs.sort()).toEqual(
			[
				"owner",
				"run-owner",
				`character:${castId}`,
				`character:${presenceId}`,
				`character:${orphanPresenceId}`
			].sort()
		)
		// The removed cast row is not asked about; a speaker is added once.
		expect(refs).not.toContain(`character:${removedId}`)
		const envoyTurn = await turnRefs(db as any, sessionId, "envoy:mascot")
		expect(envoyTurn).toContain("envoy:mascot")
		// A narrator turn asks about nobody in particular; the cast, the
		// presences, the owner and the run owner are still asked about.
		expect((await turnRefs(db as any, sessionId, null)).sort()).toEqual(
			[
				"owner",
				"run-owner",
				`character:${castId}`,
				`character:${presenceId}`,
				`character:${orphanPresenceId}`
			].sort()
		)
		// A presence detached from the session is not asked about.
		await db
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionPersonas.personaId, orphanPresenceId))
		try {
			expect(await turnRefs(db as any, sessionId, null)).not.toContain(
				`character:${orphanPresenceId}`
			)
		} finally {
			await db
				.update(schema.sessionPersonas)
				.set({ removedAt: null })
				.where(eq(schema.sessionPersonas.personaId, orphanPresenceId))
		}
	})

	it("reads membership as it stands — a guest leaving changes the next answer", async () => {
		const before = await resolve([`user:${guestId}`, `character:${presenceId}`])
		expect(before[`user:${guestId}`]).toEqual(person(guestId))
		await db
			.delete(schema.sessionGuests)
			.where(eq(schema.sessionGuests.userId, guestId))
		try {
			const after = await resolve([`user:${guestId}`, `character:${presenceId}`])
			expect(after[`user:${guestId}`]).toEqual({ by: "none" })
			// Their persona row is still there; with no member behind it and
			// no cast row, it is nobody's — not the AI's.
			expect(after[`character:${presenceId}`]).toEqual({ by: "none" })
		} finally {
			await db
				.insert(schema.sessionGuests)
				.values({ sessionId, userId: guestId })
		}
	})
})
