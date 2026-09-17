/**
 * 0138 (plans/29 R-18; U5g, 2026-09-16): the envoy's seat on the cast, and
 * the message row's `metadata.speaker` becoming the participant reference.
 *
 * Two things the file does, each pinned against rows an upgrade meets:
 *
 *  · **The seat.** `session_characters.envoy_slug`, one per envoy per
 *    session, never beside a `character_id` — the CHECK is "at most one",
 *    not "exactly one", because a globally deleted character nulls its
 *    `character_id` on a row that keeps `removed_name`, and an upgrade must
 *    not refuse that cascade.
 *  · **The move.** The side-character FACT `{ name, characterId, known }`
 *    that lived under `metadata.speaker` since the narrator split moves to
 *    `metadata.sideCharacter`, and a fact naming a character leaves the
 *    reference `character:<id>` behind under `speaker` (U5g review, W5) — a
 *    fact with no id leaves none, since there is nobody to reference. A
 *    string under `speaker` — a reference this release writes — is left
 *    where it is. Idempotent: a moved row has no object at `speaker` to
 *    move again.
 *
 * ⚠ It runs the REAL migration file, statement for statement, like the other
 * migration suites. `createTestDb` applies every migration, so the column is
 * there by the time a row can be seeded; the three DDL facts are dropped and
 * the whole file replayed against the shape 0137 left.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const MIGRATION = "drizzle/0138_envoys_seat_and_speaker_ref.sql"

let db: TestDb
let dataDir: string
let sessionId: number
let factRowId: number
let unlinkedFactRowId: number
let refRowId: number
let plainRowId: number

/** Split the way drizzle's migrator splits it. */
async function replay() {
	const { readFileSync } = await import("node:fs")
	const { resolve } = await import("node:path")
	const text = readFileSync(resolve(process.cwd(), MIGRATION), "utf8")
	for (const statement of text.split("--> statement-breakpoint")) {
		if (!statement.trim()) continue
		await db.execute(sql.raw(statement))
	}
}

const metadataOf = async (id: number) =>
	(
		await db
			.select({ metadata: schema.sessionMessages.metadata })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, id))
	)[0]!.metadata as Record<string, unknown>

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-envoy-seat-migration-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const userId = (await createTestUser(db, "envoy-seat-migration")).id
	sessionId = (
		await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()
	)[0]!.id

	// ── Back to the shape 0137 left ────────────────────────────────────────
	await db.execute(
		sql`ALTER TABLE "session_characters" DROP CONSTRAINT "session_characters_one_seat_check"`
	)
	await db.execute(sql`DROP INDEX "session_characters_envoy_idx"`)
	await db.execute(sql`ALTER TABLE "session_characters" DROP COLUMN "envoy_slug"`)

	// The rows an upgrade meets: a side-character line with the FACT under
	// `speaker`, a row already carrying a reference, and an ordinary line.
	const row = async (metadata: Record<string, unknown>) =>
		(
			await db
				.insert(schema.sessionMessages)
				.values({
					sessionId,
					userId,
					role: "assistant",
					content: "…",
					isNarratorResponse: true,
					metadata
				} as any)
				.returning({ id: schema.sessionMessages.id })
		)[0]!.id
	factRowId = await row({
		narratorName: "Bram",
		speaker: { name: "Bram", characterId: 4, known: true }
	})
	// A side character somebody typed a name for and never linked.
	unlinkedFactRowId = await row({
		narratorName: "The innkeeper",
		speaker: { name: "The innkeeper", characterId: null, known: false }
	})
	refRowId = await row({ speaker: "envoy:mascot" })
	plainRowId = await row({ swipes: { currentIdx: 0, history: ["…"] } })

	await replay()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("0138 — the seat", () => {
	it("an envoy seat is a cast row with a slug and no character; one per envoy per session", async () => {
		await db.insert(schema.sessionCharacters).values({
			sessionId,
			characterId: null,
			envoySlug: "mascot"
		})
		const rows = await db
			.select({
				characterId: schema.sessionCharacters.characterId,
				envoySlug: schema.sessionCharacters.envoySlug
			})
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
		expect(rows).toEqual([{ characterId: null, envoySlug: "mascot" }])
		await expect(
			db.insert(schema.sessionCharacters).values({
				sessionId,
				characterId: null,
				envoySlug: "mascot"
			})
		).rejects.toThrow(/session_characters_envoy_idx/)
	})

	it("a seat is never both a character's and an envoy's", async () => {
		const [character] = await db
			.insert(schema.characters)
			.values({
				userId: (
					await db.select({ id: schema.users.id }).from(schema.users)
				)[0]!.id,
				name: "Tom",
				description: "A knight."
			})
			.returning({ id: schema.characters.id })
		await expect(
			db.insert(schema.sessionCharacters).values({
				sessionId,
				characterId: character!.id,
				envoySlug: "herald"
			})
		).rejects.toThrow(/session_characters_one_seat_check/)
		// And a departed character's row — neither set — is still a row: the
		// cascade that nulls `character_id` on a global delete must not trip.
		await db.insert(schema.sessionCharacters).values({
			sessionId,
			characterId: character!.id
		})
		await db.delete(schema.characters).where(eq(schema.characters.id, character!.id))
		const departed = await db
			.select({
				characterId: schema.sessionCharacters.characterId,
				envoySlug: schema.sessionCharacters.envoySlug
			})
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
		expect(departed).toContainEqual({ characterId: null, envoySlug: null })
	})
})

describe("0138 — the move", () => {
	it("the side-character fact moves to metadata.sideCharacter and leaves character:<id> as the reference; an unlinked fact leaves none; a reference and an ordinary row are untouched", async () => {
		expect(await metadataOf(factRowId)).toEqual({
			narratorName: "Bram",
			sideCharacter: { name: "Bram", characterId: 4, known: true },
			speaker: "character:4"
		})
		// Nobody to reference: no `speaker` at all, never a reference to null.
		expect(await metadataOf(unlinkedFactRowId)).toEqual({
			narratorName: "The innkeeper",
			sideCharacter: { name: "The innkeeper", characterId: null, known: false }
		})
		expect(await metadataOf(refRowId)).toEqual({ speaker: "envoy:mascot" })
		expect(await metadataOf(plainRowId)).toEqual({
			swipes: { currentIdx: 0, history: ["…"] }
		})
	})

	it("replaying the step is a no-op", async () => {
		const before = await metadataOf(factRowId)
		await db.execute(
			sql`ALTER TABLE "session_characters" DROP CONSTRAINT "session_characters_one_seat_check"`
		)
		await db.execute(sql`DROP INDEX "session_characters_envoy_idx"`)
		await db.execute(
			sql`ALTER TABLE "session_characters" DROP COLUMN "envoy_slug"`
		)
		await replay()
		expect(await metadataOf(factRowId)).toEqual(before)
		expect((await metadataOf(factRowId)).speaker).toBe("character:4")
		expect(await metadataOf(refRowId)).toEqual({ speaker: "envoy:mascot" })
	})
})
