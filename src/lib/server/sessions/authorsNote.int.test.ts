/**
 * The session's author's note, for the Author's note widget (AN1): Chat
 * declares it; anyone in the session reads it; only the owner writes it, and
 * a write moves the note alone; the last reply's verdict is read off the
 * newest receipt that recorded one.
 */

import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { ADVENTURE_GENRE_ID, CHAT_GENRE_ID } from "@serene-pub/core-catalog"
import { genreFieldsFor } from "$lib/server/pipelines/entities/sessionGenres"
import {
	AuthorsNoteRefusal,
	readSessionAuthorsNote,
	writeSessionAuthorsNote
} from "./authorsNote"

let db: TestDb
let owner: number
let guest: number
let stranger: number

async function session(genreId: string, genreFields: Record<string, unknown> = {}) {
	const [row] = await db
		.insert(schema.sessions)
		.values({ userId: owner, isGroup: false, genreId, presetId: null, genreFields } as any)
		.returning()
	await db.insert(schema.sessionGuests).values({ sessionId: row!.id, userId: guest } as any)
	return row!
}

async function receipt(sessionId: number, runId: string, nodes: unknown[]) {
	const at = new Date()
	await db.insert(schema.pipelineRuns).values({
		runId,
		specSlug: "core:spec/respond",
		specVersion: "1.21.0",
		sessionId,
		userId: owner,
		outcome: "ok",
		triggerSource: "test",
		seed: "s",
		startedAt: at,
		endedAt: at,
		receipt: { runId, nodes }
	} as any)
}

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
	owner = (await createTestUser(db, "an-owner")).id
	guest = (await createTestUser(db, "an-guest")).id
	stranger = (await createTestUser(db, "an-stranger")).id
}, 60_000)

describe("the author's note (AN1)", () => {
	it("Chat offers it with its declared defaults; a run reads the same value", async () => {
		const s = await session(CHAT_GENRE_ID)
		const read = await readSessionAuthorsNote(db, s.id, owner)
		// At the end unless moved (owner ruling 2026-10-03; it was 4).
		expect(read).toEqual({
			offered: true,
			canEdit: true,
			note: { text: "", depth: 0, interval: 1, role: "system" },
			lastReply: null
		})
		expect((await genreFieldsFor(db, s.id)).authorsNote).toEqual({
			text: "",
			depth: 0,
			interval: 1,
			role: "system"
		})
	}, 60_000)

	it("Adventure does not offer it, and refuses a write", async () => {
		const s = await session(ADVENTURE_GENRE_ID)
		expect((await readSessionAuthorsNote(db, s.id, owner)).offered).toBe(false)
		await expect(
			writeSessionAuthorsNote(db, s.id, owner, { text: "x", depth: 1, interval: 1, role: "system" })
		).rejects.toThrow(/no author's note/)
	}, 60_000)

	it("the owner writes the note alone; a guest reads it and may not write", async () => {
		const s = await session(CHAT_GENRE_ID, { autoAdvance: "off" })
		const { answer, changed } = await writeSessionAuthorsNote(db, s.id, owner, {
			text: "It is raining.",
			depth: "2",
			interval: 3,
			role: "user"
		})
		expect(changed).toBe(true)
		expect(answer.note).toEqual({ text: "It is raining.", depth: 2, interval: 3, role: "user" })
		const fields = await genreFieldsFor(db, s.id)
		expect(fields.autoAdvance).toBe("off")
		expect(fields.authorsNote).toEqual(answer.note)

		const asGuest = await readSessionAuthorsNote(db, s.id, guest)
		expect(asGuest.canEdit).toBe(false)
		expect(asGuest.note.text).toBe("It is raining.")
		await expect(
			writeSessionAuthorsNote(db, s.id, guest, answer.note)
		).rejects.toBeInstanceOf(AuthorsNoteRefusal)
		await expect(readSessionAuthorsNote(db, s.id, stranger)).rejects.toThrow(/not found/)

		// Saving what is already there is not a change.
		expect((await writeSessionAuthorsNote(db, s.id, owner, answer.note)).changed).toBe(false)
	}, 60_000)

	it("reports the newest receipt's decision, passing over runs that made none", async () => {
		const s = await session(CHAT_GENRE_ID, {
			authorsNote: { text: "Rain.", depth: 4, interval: 2, role: "system" }
		})
		await receipt(s.id, `an-${s.id}-1`, [
			{ nodeKey: "prompt", output: { authorsNote: { included: true, reason: "included", depth: 4, interval: 2, replyCount: 0, targetIndex: 3, role: "system" } } }
		])
		await receipt(s.id, `an-${s.id}-2`, [
			{ nodeKey: "prompt", output: { authorsNote: { included: false, reason: "interval", depth: 4, interval: 2, replyCount: 1, targetIndex: 5, role: "system" } } }
		])
		// A turn-order run after it, and the builder's unplaced copy: no decision.
		await receipt(s.id, `an-${s.id}-3`, [
			{ nodeKey: "context", output: { templateContext: { authorsNote: { gatedBy: "assemble", targetIndex: 0 } } } }
		])
		expect((await readSessionAuthorsNote(db, s.id, guest)).lastReply).toEqual({
			included: false,
			reason: "interval",
			depth: 4,
			targetIndex: 5
		})
	}, 60_000)
})
