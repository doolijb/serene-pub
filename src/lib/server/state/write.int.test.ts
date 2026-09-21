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
import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	defineAttributeSlot,
	genre,
	getAttributeSlot,
	_clearAttributeSlots
} from "@serene-pub/sdk"
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

/**
 * A message in both worlds, sharing an id the way the store keeps them.
 *
 * ⚠ `speakerId` is load-bearing under the turn lock (R9): a change to a cast
 * member anchors to THAT character's latest reply, so a test about retracting
 * what a reply changed has to give the reply a speaker. Left off, the message
 * is narration and the character's anchor is null — which is its own
 * legitimate case, and has its own test.
 */
async function message(
	sessionId: number,
	content = "…",
	speakerId?: number
) {
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "assistant",
			characterId: speakerId ?? null,
			content,
			isNarratorResponse: !speakerId
		})
		.returning()
	await testDb.insert(schema.messages).values({
		id: legacy.id,
		sessionId,
		characterId: speakerId ?? null,
		role: "assistant"
	})
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
		const m = await message(w.session.id, "…", w.verity.id)
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
		const m = await message(w.session.id, "She is hurt.", w.verity.id)
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

/**
 * R-15 *Staleness and order* (plans/29; plans/30 U5f, 2026-09-17): the
 * state version, and the rebase it makes possible.
 *
 * What is pinned: every applied change moves `sessions.state_version` by
 * one and stamps the row; two applies landing together get two numbers,
 * never one (turn order); a proposal carries the version it was made
 * against; accepting one whose slot is untouched since is the rebase —
 * applied, version moved; accepting one whose slot moved is `superseded`,
 * nothing applied, the slot named; a trusted `apply` with a base behind on a
 * moved slot is refused with the versions in the sentence; `stateFor` and
 * the published values agree on the version.
 */
describe("R-15 · staleness and order (state version)", () => {
	const HP_SLOT = HP
	const MOOD = "core:slot/mood@1"

	function declareTwo() {
		declareSlots()
		defineAttributeSlot(MOOD, {
			type: "enum",
			descriptor: "How they feel.",
			appliesTo: ["cast"],
			config: { of: ["calm", "wary", "afraid"] },
			default: "calm"
		})
	}

	const versionOf = async (sessionId: number) =>
		(
			await testDb
				.select({ v: schema.sessions.stateVersion })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
		)[0]!.v

	test("every applied change moves the version by one and stamps the row; concurrent applies are monotonic", async () => {
		declareTwo()
		const w = await world()
		await message(w.session.id)
		const { applyChange } = await import("$lib/server/state/write")
		const { stateFor } = await import("$lib/server/state/resolve")
		const owner = { kind: "session_cast" as const, id: w.verity.id }
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const db = testDb as unknown as Db

		expect(await versionOf(w.session.id)).toBe(0)
		const first = await applyChange(db, ctx, { owner, slotId: HP_SLOT, value: 14 })
		expect(await versionOf(w.session.id)).toBe(1)
		const [row] = await testDb
			.select({ v: schema.attributeValues.stateVersion })
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, first))
		expect(row!.v).toBe(1)

		// A possession edge is a change too.
		const edge = await applyChange(db, ctx, { owner, entryId: w.key.id, delta: 1 })
		expect(await versionOf(w.session.id)).toBe(2)
		const [possession] = await testDb
			.select({ v: schema.sessionPossessions.stateVersion })
			.from(schema.sessionPossessions)
			.where(eq(schema.sessionPossessions.id, edge))
		expect(possession!.v).toBe(2)

		// Turn order: two applies landing together take two numbers. (Under
		// PGlite's one connection the lock is not what serialises them — see
		// the note on `nextLane`'s test — but the contract is asserted.)
		const [a, b] = await Promise.all([
			applyChange(db, ctx, { owner, slotId: HP_SLOT, value: 12 }),
			applyChange(db, ctx, { owner, slotId: MOOD, value: "wary" })
		])
		const stamped = (
			await testDb
				.select({ v: schema.attributeValues.stateVersion })
				.from(schema.attributeValues)
				.where(inArray(schema.attributeValues.id, [a, b]))
		)
			.map((r) => r.v)
			.sort()
		expect(stamped, "two applies took one number").toEqual([3, 4])
		expect(await versionOf(w.session.id)).toBe(4)

		// `stateFor` reports the same number, and the published values ride it.
		expect((await stateFor(db, w.session.id)).version).toBe(4)
		const { publishedValues } = await import(
			"$lib/server/pipelines/entities/publishedValues"
		)
		expect((await publishedValues(db, w.session.id)).state.version).toBe(4)
	}, 60_000)

	test("a proposal carries its base; accepting one whose slot is untouched since is the rebase — applied", async () => {
		declareTwo()
		const w = await world()
		await message(w.session.id)
		const { applyChange, decideProposal, proposeChange } = await import(
			"$lib/server/state/write"
		)
		const { valueOf } = await import("$lib/server/state/resolve")
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const marrow = { kind: "session_cast" as const, id: w.marrow.id }
		const user = { sessionId: w.session.id, updatedBy: "user" }

		// Three hand-sets: the version is 3.
		for (const value of [19, 18, 17])
			await applyChange(db, user, { owner: verity, slotId: HP_SLOT, value })
		expect(await versionOf(w.session.id)).toBe(3)

		// The model proposes at v3 (no explicit base: stamped from the session).
		const id = await proposeChange(
			db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{ owner: verity, slotId: MOOD, value: "afraid" }
		)
		const [held] = await testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, id))
		expect(held!.baseVersion).toBe(3)
		// The base never lands in the payload.
		expect((held!.payload as Record<string, unknown>).base).toBeUndefined()

		// A DIFFERENT slot moves (v4) before anyone decides.
		await applyChange(db, user, { owner: marrow, slotId: HP_SLOT, value: 9 })
		expect(await versionOf(w.session.id)).toBe(4)

		// Accept: the delta still holds — applied, version 5, status accepted.
		const outcome = await decideProposal(db, id, true)
		expect(outcome.status).toBe("accepted")
		expect(outcome.appliedId).toBeDefined()
		expect(await versionOf(w.session.id)).toBe(5)
		expect(
			await valueOf(db, { sessionId: w.session.id, owner: verity, slotId: MOOD })
		).toBe("afraid")
		const [decided] = await testDb
			.select({ status: schema.stateProposals.status })
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, id))
		expect(decided!.status).toBe("accepted")
	}, 60_000)

	test("accepting a proposal whose slot moved since its base is superseded — nothing applied, the slot named", async () => {
		declareTwo()
		const w = await world()
		await message(w.session.id)
		const { applyChange, decideProposal, proposeChange, StateRefusal } =
			await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const user = { sessionId: w.session.id, updatedBy: "user" }

		for (const value of [19, 18, 17])
			await applyChange(db, user, { owner: verity, slotId: HP_SLOT, value })
		// Proposed at v3 with an explicit base, as `set-state` stamps it.
		const id = await proposeChange(
			db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			{ owner: verity, slotId: HP_SLOT, value: 5, base: 3 }
		)
		// The SAME slot moves (v4).
		await applyChange(db, user, { owner: verity, slotId: HP_SLOT, value: 11 })
		expect(await versionOf(w.session.id)).toBe(4)

		const outcome = await decideProposal(db, id, true)
		expect(outcome.status).toBe("superseded")
		expect(outcome.appliedId).toBeUndefined()
		expect(outcome.movedSlots).toEqual(["hp"])
		// Nothing applied: the hand-set stands, the version did not move.
		expect(
			await valueOf(db, { sessionId: w.session.id, owner: verity, slotId: HP_SLOT })
		).toBe(11)
		expect(await versionOf(w.session.id)).toBe(4)
		const [row] = await testDb
			.select({
				status: schema.stateProposals.status,
				decidedAt: schema.stateProposals.decidedAt
			})
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, id))
		expect(row!.status).toBe("superseded")
		expect(row!.decidedAt).not.toBeNull()
		// Decided once: a second decision is refused like any other.
		await expect(decideProposal(db, id, true)).rejects.toBeInstanceOf(StateRefusal)
		await expect(decideProposal(db, id, false)).rejects.toThrow(/already superseded/)
	}, 60_000)

	test("a trusted apply with a base behind on a moved slot is refused with the versions named; untouched slots still apply", async () => {
		declareTwo()
		const w = await world()
		await message(w.session.id)
		const { applyChange, StateRefusal } = await import("$lib/server/state/write")
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const user = { sessionId: w.session.id, updatedBy: "user" }
		const run = { sessionId: w.session.id, updatedBy: "run:keeper" }

		await applyChange(db, user, { owner: verity, slotId: HP_SLOT, value: 19 })
		await applyChange(db, user, { owner: verity, slotId: HP_SLOT, value: 18 })
		const read = await versionOf(w.session.id) // the run read at v2
		await applyChange(db, user, { owner: verity, slotId: HP_SLOT, value: 3 }) // v3: hp moved

		// hp moved past the base: refused, with the versions.
		await expect(
			applyChange(db, run, { owner: verity, slotId: HP_SLOT, value: 15, base: read })
		).rejects.toThrow(
			"hp changed since this run read it (v2 → v3); resolve-state-changes must rebase on the next turn"
		)
		await expect(
			applyChange(db, run, { owner: verity, slotId: HP_SLOT, value: 15, base: read })
		).rejects.toBeInstanceOf(StateRefusal)
		// mood did not: the same base applies fine.
		const applied = await applyChange(db, run, {
			owner: verity,
			slotId: MOOD,
			value: "wary",
			base: read
		})
		expect(applied).toBeGreaterThan(0)
		expect(await versionOf(w.session.id)).toBe(4)
		// A base at the current version, and no base at all, apply as before.
		await applyChange(db, run, { owner: verity, slotId: HP_SLOT, value: 15, base: 4 })
		await applyChange(db, run, { owner: verity, slotId: HP_SLOT, value: 16 })
		expect(await versionOf(w.session.id)).toBe(6)
	}, 60_000)

	/**
	 * The three reads that have to sit UNDER the lock (U5f review, 2026-09-17):
	 * the base check, the current value a delta is applied to, and the
	 * version `stateFor` hands a run as its base.
	 *
	 * ⚠ PGlite is one connection and runs these transactions one after the
	 * other on its own — but it interleaves the QUERIES two callers make
	 * ahead of their transactions strictly turn about, which is exactly the
	 * shape of the defect: a check or a read made before the transaction is
	 * made by both callers before either writes. So these do detect the
	 * regression; the advisory lock is what makes the same true on a pool.
	 */
	test("two writers with one base on one slot: exactly one lands, the other is refused as moved — the base check is under the lock", async () => {
		declareTwo()
		const w = await world()
		await message(w.session.id)
		const { applyChange, StateRefusal } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const run = { sessionId: w.session.id, updatedBy: "run:keeper" }

		await applyChange(db, run, { owner: verity, slotId: HP_SLOT, value: 19 })
		const read = await versionOf(w.session.id) // both writers read at v1

		const results = await Promise.allSettled([
			applyChange(db, run, { owner: verity, slotId: HP_SLOT, value: 15, base: read }),
			applyChange(db, run, { owner: verity, slotId: HP_SLOT, value: 3, base: read })
		])
		const landed = results.filter((r) => r.status === "fulfilled")
		const refused = results.filter(
			(r): r is PromiseRejectedResult => r.status === "rejected"
		)
		expect(landed, "two writers with one base both landed on one slot").toHaveLength(1)
		expect(refused).toHaveLength(1)
		expect(refused[0]!.reason).toBeInstanceOf(StateRefusal)
		expect(refused[0]!.reason.message).toBe(
			"hp changed since this run read it (v1 → v2); resolve-state-changes must rebase on the next turn"
		)
		// The version moved once, and the value is whichever writer landed.
		expect(await versionOf(w.session.id)).toBe(read + 1)
		expect([15, 3]).toContain(
			await valueOf(db, { sessionId: w.session.id, owner: verity, slotId: HP_SLOT })
		)
	}, 60_000)

	test("two deltas landing together on one integer slot both count — the current value is read under the lock", async () => {
		declareTwo()
		const w = await world()
		await message(w.session.id)
		const { applyChange } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const user = { sessionId: w.session.id, updatedBy: "user" }

		await applyChange(db, user, { owner: verity, slotId: HP_SLOT, value: 0 })
		await Promise.all([
			applyChange(db, user, { owner: verity, slotId: HP_SLOT, op: "add", value: 1 }),
			applyChange(db, user, { owner: verity, slotId: HP_SLOT, op: "add", value: 1 })
		])
		expect(
			await valueOf(db, { sessionId: w.session.id, owner: verity, slotId: HP_SLOT }),
			"two deltas read the same current value and one was lost"
		).toBe(2)
		expect(await versionOf(w.session.id)).toBe(3)
	}, 60_000)

	test("stateFor reads the version FIRST: a write landing mid-resolution leaves a base the rebase refuses, never one it applies blind", async () => {
		declareTwo()
		// The session has to carry a genre that BRINGS hp: a vocabulary is the
		// genre's, not the registry's, and the default chat genre tracks nothing
		// — `stateFor` on it reads no value at all.
		const STALE_GENRE = "test:genre/stale"
		genre(STALE_GENRE, {
			name: { en: "Stale" },
			family: "test",
			slots: [getAttributeSlot(HP_SLOT)!, getAttributeSlot(MOOD)!],
			events: {}
		})
		const w = await world()
		await testDb
			.update(schema.sessions)
			.set({ genreId: STALE_GENRE })
			.where(eq(schema.sessions.id, w.session.id))
		await message(w.session.id)
		const { applyChange } = await import("$lib/server/state/write")
		const { stateFor } = await import("$lib/server/state/resolve")
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const user = { sessionId: w.session.id, updatedBy: "user" }
		const run = { sessionId: w.session.id, updatedBy: "run:keeper" }

		await applyChange(db, user, { owner: verity, slotId: HP_SLOT, value: 19 })
		const read = await versionOf(w.session.id) // v1

		// A write deliberately interleaved into the resolution: the first
		// value read `stateFor` makes is preceded by a hand-set landing (v2).
		// The driver's `query` is the one door every drizzle statement takes,
		// so wrapping it is how the order is pinned without touching either
		// module.
		const client = testDb.$client
		const original = client.query
		let armed = true
		client.query = async function (this: typeof client, ...args: Parameters<typeof original>) {
			if (armed && /from "attribute_values"/.test(String(args[0]))) {
				armed = false
				await applyChange(db, user, { owner: verity, slotId: HP_SLOT, value: 3 })
			}
			return original.apply(this, args)
		} as typeof original
		let state
		try {
			state = await stateFor(db, w.session.id)
		} finally {
			client.query = original
		}
		expect(armed, "the interleaved write never fired").toBe(false)

		// It saw the newer value — and reports the OLDER version, the one it
		// was resolved at rather than the one a write landed at mid-read.
		expect(state.cast.byId[String(w.verity.id)]!.hp).toBe(3)
		expect(state.version, "the version was read after the values").toBe(read)
		// The safe side: a delta against that base on the slot that moved is
		// refused. A base of v2 would have applied it over the hand-set.
		await expect(
			applyChange(db, run, { owner: verity, slotId: HP_SLOT, value: 15, base: state.version })
		).rejects.toThrow(
			"hp changed since this run read it (v1 → v2); resolve-state-changes must rebase on the next turn"
		)
		expect(await versionOf(w.session.id)).toBe(2)
	}, 60_000)

	test("two transfers of the last item landing together: one succeeds, the other is refused, the item never duplicates — the held check is under the lock", async () => {
		declareTwo()
		const w = await world()
		await message(w.session.id)
		const { applyChange, heldQuantity, transferPossession, StateRefusal } =
			await import("$lib/server/state/write")
		const db = testDb as unknown as Db
		const verity = { kind: "session_cast" as const, id: w.verity.id }
		const marrow = { kind: "session_cast" as const, id: w.marrow.id }
		const user = { sessionId: w.session.id, updatedBy: "user" }
		const held = (owner: typeof verity) =>
			heldQuantity(db, w.session.id, owner, w.key.id)

		// Verity holds the one key (v1).
		await applyChange(db, user, { owner: verity, entryId: w.key.id, delta: 1 })
		const results = await Promise.allSettled([
			transferPossession(db, user, { from: verity, to: marrow, entryId: w.key.id }),
			transferPossession(db, user, { from: verity, to: marrow, entryId: w.key.id })
		])
		const done = results.filter((r) => r.status === "fulfilled")
		const refused = results.filter(
			(r): r is PromiseRejectedResult => r.status === "rejected"
		)
		expect(done, "both transfers of one key went through").toHaveLength(1)
		expect(refused).toHaveLength(1)
		expect(refused[0]!.reason).toBeInstanceOf(StateRefusal)
		expect(refused[0]!.reason.message).toBe("that owner is not carrying that.")
		// Conserved: one key in the world, in Marrow's hands.
		expect(await held(verity)).toBe(0)
		expect(await held(marrow), "the key was duplicated").toBe(1)
		// The take and the give each took a number, and landed together: v3.
		expect(await versionOf(w.session.id)).toBe(3)
	}, 60_000)
})

// ── The turn lock (R9) ──────────────────────────────────────────────────────

describe("the turn lock", () => {
	test("a change anchors to THAT character's latest reply, not the session's", async () => {
		declareSlots()
		const w = await world()
		const hers = await message(w.session.id, "I am hurt.", w.verity.id)
		// Marrow speaks after her. Her ledger is not sealed by his turn — it
		// was not his turn that produced it.
		await message(w.session.id, "Then rest.", w.marrow.id)

		const { setValue } = await import("$lib/server/state/write")
		const id = await setValue(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 9
			}
		)
		const [row] = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, id))
		expect(row.validFromMessageId).toBe(hers.id)
	})

	test("the world follows the newest message, whoever wrote it", async () => {
		declareSlots()
		const w = await world()
		await message(w.session.id, "…", w.verity.id)
		const newest = await message(w.session.id, "The sky opens.")

		const { movePossession } = await import("$lib/server/state/write")
		const id = await movePossession(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{
				owner: { kind: "session", id: w.session.id },
				entryId: w.key.id,
				delta: 1
			}
		)
		const [row] = await testDb
			.select()
			.from(schema.sessionPossessions)
			.where(eq(schema.sessionPossessions.id, id))
		expect(row.validFromMessageId).toBe(newest.id)
	})

	test("before a character's first reply the anchor is null, and null is open", async () => {
		declareSlots()
		const w = await world()
		// Somebody else has spoken; she has not.
		await message(w.session.id, "…", w.marrow.id)
		const { setValue } = await import("$lib/server/state/write")
		const id = await setValue(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 12
			}
		)
		const [row] = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, id))
		expect(row.validFromMessageId).toBeNull()
	})

	test("a sealed reply is refused by name, with what to do instead", async () => {
		declareSlots()
		const w = await world()
		const older = await message(w.session.id, "…", w.verity.id)
		await message(w.session.id, "…", w.verity.id)

		const { setValue, StateRefusal } = await import(
			"$lib/server/state/write"
		)
		const write = setValue(
			testDb as unknown as Db,
			{
				sessionId: w.session.id,
				updatedBy: "user",
				messageId: older.id
			},
			{
				owner: { kind: "session_cast", id: w.verity.id },
				slotId: HP,
				value: 1
			}
		)
		await expect(write).rejects.toBeInstanceOf(StateRefusal)
		await expect(write).rejects.toThrow(
			new RegExp(`sealed: ${w.verity.name} has spoken since`)
		)
	})

	test("authoring a card is not play, so it is never locked", async () => {
		declareSlots()
		const w = await world()
		await message(w.session.id, "…", w.verity.id)
		await message(w.session.id, "…", w.verity.id)
		const { configure } = await import("$lib/server/state/write")
		// A `card` owner with an anchor that is nobody's open one: authoring.
		const id = await configure(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user", messageId: 1 },
			{
				owner: { kind: "card", id: w.verity.id },
				slotId: HP,
				config: { max: 40 }
			}
		)
		const [row] = await testDb
			.select()
			.from(schema.attributeConfigs)
			.where(eq(schema.attributeConfigs.id, id))
		expect(row.validFromMessageId).toBeNull()
	})
})

// ── Lists (R18) ─────────────────────────────────────────────────────────────

describe("a list is changed by op, not by rewriting the line", () => {
	const CONDITIONS = "core:slot/conditions@1"

	function declareList(config: Record<string, unknown> = {}) {
		defineAttributeSlot(CONDITIONS, {
			type: "list",
			descriptor: "What is currently true of them.",
			appliesTo: ["cast"],
			config,
			default: []
		})
	}

	test("add, remove and set each do one thing", async () => {
		declareSlots()
		declareList()
		const w = await world()
		await message(w.session.id, "…", w.verity.id)
		const { setValue } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session_cast" as const, id: w.verity.id }
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		const read = () =>
			valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner,
				slotId: CONDITIONS
			})

		await setValue(testDb as unknown as Db, ctx, {
			owner,
			slotId: CONDITIONS,
			op: "add",
			items: ["bleeding"]
		})
		expect(await read()).toEqual(["bleeding"])

		await setValue(testDb as unknown as Db, ctx, {
			owner,
			slotId: CONDITIONS,
			op: "add",
			items: ["winded", "bleeding"]
		})
		// Unique unless stated: the repeat is not a second item.
		expect(await read()).toEqual(["bleeding", "winded"])

		await setValue(testDb as unknown as Db, ctx, {
			owner,
			slotId: CONDITIONS,
			op: "remove",
			items: ["bleeding"]
		})
		expect(await read()).toEqual(["winded"])

		// Removing what is not there is not an error: the state asked for is
		// the state afterwards.
		await setValue(testDb as unknown as Db, ctx, {
			owner,
			slotId: CONDITIONS,
			op: "remove",
			items: ["cursed"]
		})
		expect(await read()).toEqual(["winded"])

		await setValue(testDb as unknown as Db, ctx, {
			owner,
			slotId: CONDITIONS,
			op: "set",
			value: ["calm"]
		})
		expect(await read()).toEqual(["calm"])
	})

	test("an overflow is refused, never trimmed", async () => {
		declareSlots()
		declareList({ maxItems: 1 })
		const w = await world()
		await message(w.session.id, "…", w.verity.id)
		const { setValue, StateRefusal } = await import(
			"$lib/server/state/write"
		)
		const owner = { kind: "session_cast" as const, id: w.verity.id }
		const ctx = { sessionId: w.session.id, updatedBy: "user" }
		await setValue(testDb as unknown as Db, ctx, {
			owner,
			slotId: CONDITIONS,
			op: "add",
			items: ["bleeding"]
		})
		// Silently dropping the sword somebody just picked up is how an
		// inventory starts lying about itself.
		await expect(
			setValue(testDb as unknown as Db, ctx, {
				owner,
				slotId: CONDITIONS,
				op: "add",
				items: ["winded"]
			})
		).rejects.toBeInstanceOf(StateRefusal)
	})

	test("an integer's `add` is a signed delta against what it resolves to", async () => {
		declareSlots()
		const w = await world()
		await message(w.session.id, "…", w.verity.id)
		const { setValue } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session_cast" as const, id: w.verity.id }
		await setValue(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			{ owner, slotId: HP, op: "add", value: -6 }
		)
		// 20 by default, less six.
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner,
				slotId: HP
			})
		).toBe(14)
	})
})

// ── The gate, and its phases (R11) ──────────────────────────────────────────

describe("the one gate", () => {
	const ALARM = "core:slot/alarm@1"
	const MOOD = "core:slot/mood@1"

	/**
	 * ⚠ The session has to carry a genre that BRINGS these slots, because a
	 * session's vocabulary is its genre's and not the registry's — that is the
	 * whole of "a newcomer in a chat session never sees a bar", and rules are
	 * read off the vocabulary.
	 */
	const GATE_GENRE = "test:genre/gate"

	/** A session of the gate's genre. */
	const gateWorld = async () => {
		const w = await world()
		await testDb
			.update(schema.sessions)
			.set({ genreId: GATE_GENRE })
			.where(eq(schema.sessions.id, w.session.id))
		return w
	}

	/**
	 * Two rules that would CHAIN if rules ran more than once: dropping below
	 * five makes her wary, and being wary raises the alarm. A single pass sees
	 * the state before the change set plus the changes coming in — never
	 * another rule's output — so the alarm stays down.
	 */
	function declareRules() {
		_clearAttributeSlots()
		defineAttributeSlot(HP, {
			type: "integer",
			descriptor: "How much punishment they can still take.",
			appliesTo: ["cast"],
			config: { min: 0, max: 20 },
			default: 20
		})
		defineAttributeSlot(MOOD, {
			type: "enum",
			descriptor: "How they are feeling.",
			appliesTo: ["cast"],
			config: { of: ["calm", "wary"] },
			default: "calm",
			rules: [{ when: "owner.hp < 5", set: "'wary'" }]
		})
		defineAttributeSlot(ALARM, {
			type: "boolean",
			descriptor: "Whether the camp has been roused.",
			appliesTo: ["cast"],
			default: false,
			rules: [{ when: "owner.mood == 'wary'", set: "true" }]
		})
		genre(GATE_GENRE, {
			name: { en: "Gate" },
			family: "test",
			slots: [
				getAttributeSlot(ALARM)!,
				getAttributeSlot(HP)!,
				getAttributeSlot(MOOD)!
			],
			events: {}
		})
	}

	test("a rule sees the incoming change and fires once", async () => {
		declareRules()
		const w = await gateWorld()
		await message(w.session.id, "…", w.verity.id)
		const { applyChangeSet } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session_cast" as const, id: w.verity.id }

		const outcome = await applyChangeSet(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			[{ owner, slotId: HP, value: 3 }],
			{ mode: "apply", seed: "seed-1" }
		)
		expect(outcome.refused).toEqual([])
		// The change, plus the one rule that fired.
		expect(outcome.applied).toHaveLength(2)

		const read = (slotId: string) =>
			valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner,
				slotId
			})
		expect(await read(HP)).toBe(3)
		expect(await read(MOOD)).toBe("wary")
		// ⚠ Single pass: the alarm rule ran against the mood BEFORE the mood
		// rule wrote one. Chaining would need an order nobody wrote down.
		expect(await read(ALARM)).toBe(false)
	})

	test("every rule is reported, fired or not, in vocabulary order", async () => {
		declareRules()
		const w = await gateWorld()
		await message(w.session.id, "…", w.verity.id)
		const { applyChangeSet } = await import("$lib/server/state/write")
		const outcome = await applyChangeSet(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			[
				{
					owner: { kind: "session_cast", id: w.verity.id },
					slotId: HP,
					value: 18
				}
			],
			{ mode: "apply", seed: "seed-2" }
		)
		expect(outcome.rulesFired.map((f) => f.slotId)).toEqual([ALARM, MOOD])
		expect(outcome.rulesFired.map((f) => f.result)).toEqual([
			"skipped",
			"skipped"
		])
		expect(outcome.rulesFired.every((f) => f.ownerKey)).toBe(true)
		expect(outcome.applied).toHaveLength(1)
	})

	test("rules run for the owners the set names, and no others", async () => {
		declareRules()
		const w = await gateWorld()
		await message(w.session.id, "…", w.verity.id)
		const { applyChangeSet } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		await applyChangeSet(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			[
				{
					owner: { kind: "session_cast", id: w.verity.id },
					slotId: HP,
					value: 2
				}
			],
			{ mode: "apply", seed: "seed-3" }
		)
		// Marrow was not in the change set, so nothing was written about him —
		// a write appearing from nowhere is what the ledger exists to prevent.
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: w.session.id,
				owner: { kind: "session_cast", id: w.marrow.id },
				slotId: MOOD
			})
		).toBe("calm")
	})

	test("a refusal is a result, and the rest of the set still lands", async () => {
		declareRules()
		const w = await gateWorld()
		await message(w.session.id, "…", w.verity.id)
		const { applyChangeSet } = await import("$lib/server/state/write")
		const owner = { kind: "session_cast" as const, id: w.verity.id }
		const outcome = await applyChangeSet(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			[
				{ owner, slotId: HP, value: 99 },
				{ owner, slotId: MOOD, value: "calm" }
			],
			{ mode: "apply", seed: "seed-4" }
		)
		expect(outcome.refused).toHaveLength(1)
		expect(outcome.refused[0].reason).toMatch(/does not go above 20/)
		expect(outcome.applied.length).toBeGreaterThanOrEqual(1)
	})

	test("proposing holds the same set, validated the same way", async () => {
		declareRules()
		const w = await gateWorld()
		await message(w.session.id, "…", w.verity.id)
		const { applyChangeSet } = await import("$lib/server/state/write")
		const outcome = await applyChangeSet(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "run:abc" },
			[
				{
					owner: { kind: "session_cast", id: w.verity.id },
					slotId: HP,
					value: 4
				}
			],
			{ mode: "propose", seed: "seed-5" }
		)
		expect(outcome.applied).toEqual([])
		// The change, and the rule the change would fire: both held, so a
		// person decides on the whole consequence rather than half of it.
		expect(outcome.proposed).toHaveLength(2)
	})

	test("a retired slot refuses at the gate, in its own sentence", async () => {
		declareRules()
		const { retireAttributeSlot, defineStoredAttributeSlot } = await import(
			"@serene-pub/sdk"
		)
		const mine = "somebody:slot/dread@1"
		defineStoredAttributeSlot(
			mine,
			{
				type: "integer",
				descriptor: "How frightened they are.",
				appliesTo: ["cast"],
				config: { min: 0, max: 10 }
			},
			{ userId: 1 }
		)
		retireAttributeSlot(mine)
		const w = await gateWorld()
		await message(w.session.id, "…", w.verity.id)
		const { applyChangeSet } = await import("$lib/server/state/write")
		const outcome = await applyChangeSet(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			[
				{
					owner: { kind: "session_cast", id: w.verity.id },
					slotId: mine,
					value: 5
				}
			],
			{ mode: "apply", seed: "seed-6" }
		)
		expect(outcome.applied).toEqual([])
		expect(outcome.refused[0].reason).toMatch(/is retired/)
	})

	test("nothing to change is not a failure, and pays for no reads", async () => {
		declareRules()
		const w = await gateWorld()
		const { applyChangeSet } = await import("$lib/server/state/write")
		const outcome = await applyChangeSet(
			testDb as unknown as Db,
			{ sessionId: w.session.id, updatedBy: "user" },
			[],
			{ mode: "apply" }
		)
		expect(outcome).toMatchObject({
			applied: [],
			proposed: [],
			refused: [],
			rulesFired: []
		})
		expect(outcome.budget.evaluations).toBe(0)
	})
})
