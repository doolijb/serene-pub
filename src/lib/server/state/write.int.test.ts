/**
 * Writing state: possessions, the review gate, and retraction.
 *
 * ## Retraction is two mechanisms, because a message dies two ways
 *
 * **Deleted** — the row goes, and every anchored row goes with it by foreign
 * key. **Replaced** — a swipe or a regenerate keeps the row and its id and
 * changes only the text, so nothing is deleted and no cascade fires. Both are
 * asserted here, because the second is the one a schema cannot enforce and the
 * one that would silently leave a dead reply's damage on a character sheet.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// The turn itself is not what this file is about; the handler under test calls
// it on the way out and a real one would try to reach a model.
vi.mock("../utils/runReply", () => ({
	runReply: async () => ({ ok: true })
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-state-write-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"

function declareSlots() {
	_clearAttributeSlots()
	defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 20 },
		default: 20
	})
}

let n = 0

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `state-write-${suffix}`)
	const mk = async (name: string) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId: user.id, name, description: "…" })
				.returning()
		)[0]
	const verity = await mk(`Verity ${suffix}`)
	const marrow = await mk(`Marrow ${suffix}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, name: `Run ${suffix}` })
		.returning()
	for (const c of [verity, marrow])
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: session.id, characterId: c.id })
	await testDb
		.insert(schema.sessionLorebooks)
		.values({ sessionId: session.id, lorebookId: lorebook.id })
	const [key] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: lorebook.id,
			typeId: "core:entry/world-lore",
			typeVersion: 1,
			position: 0,
			title: "A rusty key",
			content: "Green with age."
		})
		.returning()
	return { user, verity, marrow, lorebook, session, key }
}

/** A message in both worlds, sharing an id the way the store keeps them. */
async function message(sessionId: number, content = "…") {
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "assistant",
			content,
			isNarratorResponse: true
		})
		.returning()
	await testDb
		.insert(schema.messages)
		.values({ id: legacy.id, sessionId, role: "assistant" })
	return legacy
}

const anchoredValues = async (messageId: number) =>
	await testDb
		.select()
		.from(schema.attributeValues)
		.where(eq(schema.attributeValues.validFromMessageId, messageId))

describe("possessions", () => {
	test("a transfer is a take and a give, on one anchor", async () => {
		declareSlots()
		const w = await world()
		const m = await message(w.session.id)
		const { heldQuantity, movePossession, transferPossession } =
			await import("$lib/server/state/write")
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const marrow = { kind: "session_cast" as const, id: w.marrow.id }

		await movePossession(testDb as unknown as Db, ctx, {
			owner: verity,
			entryId: w.key.id,
			delta: 2
		})
		expect(
			await heldQuantity(
				testDb as unknown as Db,
				w.session.id,
				verity,
				w.key.id
			)
		).toBe(2)

		await transferPossession(testDb as unknown as Db, ctx, {
			from: verity,
			to: marrow,
			entryId: w.key.id,
			quantity: 1
		})
		expect(
			await heldQuantity(
				testDb as unknown as Db,
				w.session.id,
				verity,
				w.key.id
			)
		).toBe(1)
		expect(
			await heldQuantity(
				testDb as unknown as Db,
				w.session.id,
				marrow,
				w.key.id
			)
		).toBe(1)
		expect(m.id).toBeGreaterThan(0)
	})

	test("giving what nobody is carrying is refused by name", async () => {
		declareSlots()
		const w = await world()
		const { StateRefusal, transferPossession } = await import(
			"$lib/server/state/write"
		)
		await expect(
			transferPossession(
				testDb as unknown as Db,
				{ sessionId: w.session.id, updatedBy: "user" },
				{
					from: { kind: "session_cast", id: w.verity.id },
					to: { kind: "session_cast", id: w.marrow.id },
					entryId: w.key.id
				}
			)
		).rejects.toBeInstanceOf(StateRefusal)
	})
})

describe("the review gate", () => {
	test("accepting a proposal applies it with the proposer's provenance", async () => {
		declareSlots()
		const w = await world()
		await message(w.session.id)
		const { decideProposal, proposeChange } = await import(
			"$lib/server/state/write"
		)
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session_cast" as const, id: w.verity.id }

		const id = await proposeChange(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{ owner, slotId: HP, value: 14 }
		)
		// Nothing has happened yet — that is the whole point of a proposal.
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner,
				slotId: HP
			})
		).toBe(20)

		const outcome = await decideProposal(testDb as unknown as Db, id, true)
		expect(outcome.status).toBe("accepted")
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner,
				slotId: HP
			})
		).toBe(14)
		const [written] = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, outcome.appliedId!))
		expect(written.updatedBy).toBe("run:abc")
	})

	test("rejecting one changes nothing and cannot be decided twice", async () => {
		declareSlots()
		const w = await world()
		await message(w.session.id)
		const { decideProposal, proposeChange, StateRefusal } = await import(
			"$lib/server/state/write"
		)
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session_cast" as const, id: w.verity.id }
		const id = await proposeChange(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{ owner, slotId: HP, value: 3 }
		)
		expect(
			(await decideProposal(testDb as unknown as Db, id, false)).status
		).toBe("rejected")
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner,
				slotId: HP
			})
		).toBe(20)
		await expect(
			decideProposal(testDb as unknown as Db, id, true)
		).rejects.toBeInstanceOf(StateRefusal)
	})
})

describe("retraction", () => {
	test("deleting a message takes its anchored rows with it", async () => {
		declareSlots()
		const w = await world()
		const m = await message(w.session.id)
		const { setValue } = await import("$lib/server/state/write")
		await setValue(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 9
			}
		)
		expect(await anchoredValues(m.id)).toHaveLength(1)

		const { deleteLegacy } = await import("$lib/server/messages/store")
		await deleteLegacy(testDb as unknown as Db, m.id)
		expect(await anchoredValues(m.id)).toHaveLength(0)
	})

	test("regenerating a reply retracts what that reply changed", async () => {
		declareSlots()
		const w = await world()
		const m = await message(w.session.id, "She is hurt.")
		const { setValue } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session_cast" as const, id: w.verity.id }
		await setValue(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{ owner, slotId: HP, value: 9 }
		)
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner,
				slotId: HP
			})
		).toBe(9)

		const { sessionMessagesRegenerateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionMessagesRegenerateHandler.handler(
			{
				user: { id: w.user.id },
				io: { to: () => ({ emit: () => {} }) }
			} as any,
			{ id: m.id } as any,
			() => {}
		)

		// The row is still there — a regenerate replaces text, it does not
		// delete — and the value it wrote is gone with the sentence.
		expect(
			(
				await testDb
					.select()
					.from(schema.sessionMessages)
					.where(eq(schema.sessionMessages.id, m.id))
			).length
		).toBe(1)
		expect(await anchoredValues(m.id)).toHaveLength(0)
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner,
				slotId: HP
			})
		).toBe(20)
	})

	test("a message's pending proposals go with it too", async () => {
		declareSlots()
		const w = await world()
		const m = await message(w.session.id)
		const { proposeChange } = await import("$lib/server/state/write")
		await proposeChange(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 1
			}
		)
		const { retractStateAnchoredTo } = await import(
			"$lib/server/state/write"
		)
		await retractStateAnchoredTo(testDb as unknown as Db, m.id)
		expect(
			await testDb
				.select()
				.from(schema.stateProposals)
				.where(eq(schema.stateProposals.messageId, m.id))
		).toHaveLength(0)
	})
})
