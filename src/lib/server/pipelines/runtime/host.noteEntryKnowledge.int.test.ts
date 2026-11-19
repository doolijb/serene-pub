/**
 * 🚧 `core:outlet/note-entry-knowledge@1` (kn-4b): one cast member came to know
 * one entry in play, or no longer does. Driven through the real host commit:
 * where the tie lands (the lorebook on the session's line under Full on your own
 * book; the session's notes otherwise), that it never overwrites or ends the
 * owner's hand, that it is written once, that `end` ends only play's ties, and
 * that Back and a swipe take it back with the reply.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { insertCastMember } from "$lib/server/characters/versions"
import {
	loadEntryKnowledge,
	writeKnowledgeTie
} from "$lib/server/lorebooks/entryKnowledge"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db

const NOTE = { key: "note", definitionId: "core:outlet/note-entry-knowledge" } as any
const REFERENCE_GENRE = "chariot.desk:inlet/reference@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-note-entry-knowledge-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	await db.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.desk:inlet/reference",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Reference Desk" } },
		ports: {},
		sessionShape: { composer: "text", lorebook: "optional", writes: { lore: false, scenes: false } }
	} as any)
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

type Kind = "full" | "review" | "member" | "reference"

/** A lorebook with Mira (seated) and Ola, a place, and a session reading it. */
async function world(kind: Kind) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(db, `nek-${suffix}`)
	const who = kind === "member" ? await createTestUser(db, `nek-member-${suffix}`) : owner
	await db
		.insert(schema.userSettings)
		.values({ userId: owner.id, loreWriteMode: kind === "review" ? "review" : "full" })
	if (kind === "member") await db.insert(schema.userSettings).values({ userId: who.id, loreWriteMode: "full" })
	const [book] = await db.insert(schema.lorebooks).values({ userId: owner.id, name: `World ${suffix}` }).returning()
	// Under Full the session's first write forks its own line (a play tie is ended only on it).
	const [fork] =
		kind === "full"
			? await db.insert(schema.lorebookBranches).values({ lorebookId: book!.id, name: `Fork ${suffix}`, forkYear: 4 }).returning()
			: []
	const [card] = await db
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Mira", description: "…" } as never)
		.returning()
	const mira = (
		await insertCastMember(asDb(), {
			lorebookId: book!.id,
			binding: `{{char:Mira${suffix}}}`,
			characterId: card!.id,
			name: "Mira"
		})
	).member!.id
	const ola = (await insertCastMember(asDb(), { lorebookId: book!.id, binding: `{{char:Ola${suffix}}}`, name: "Ola" }))
		.member!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: who.id,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			...(fork ? { lorebookBranchId: fork.id, lineOnFirstWrite: true } : {}),
			...(kind === "reference" ? { genreId: REFERENCE_GENRE } : {})
		} as never)
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: card!.id,
		castMemberId: mira,
		position: 0,
		seatedByUserId: who.id,
		isActive: true
	} as never)
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(asDb(), session!.id)
	const secret = (
		await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: book!.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: `The Vault ${suffix}`,
				content: "Hidden.",
				fields: { category: "Rooms" },
				notCommonKnowledge: true
			} as never)
			.returning()
	)[0]!
	const message = async () => {
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await db.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
		return legacy!
	}
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = (runId: string) => createHost(asDb(), { sessionId: session!.id, userId: who.id, runId } as any)
	const note = (runId: string, payload: Record<string, unknown>) =>
		host(runId).commit!(payload, NOTE) as Promise<any>
	const told = (runId: string, extra: Record<string, unknown> = {}, member: unknown = mira, entry: unknown = secret.id) =>
		note(runId, { member, entry, ...extra })
	const ties = (lorebookId: number) =>
		db
			.select()
			.from(schema.narrativeRelationships)
			.where(
				and(eq(schema.narrativeRelationships.lorebookId, lorebookId), eq(schema.narrativeRelationships.fromNodeId, mira))
			)
			.orderBy(schema.narrativeRelationships.id)
	const hand = (castMemberId: number, kind: "knows" | "kept_from") =>
		writeKnowledgeTie(asDb(), {
			userId: owner.id,
			lorebookId: book!.id,
			castMemberId,
			entryId: secret.id,
			kind
		})
	const reads = async () => {
		const r = await loadEntryKnowledge(asDb(), { sessionId: session!.id, speaker: `character:${card!.id}` })
		return r.kind === "judged" ? r.leftOut.map((l) => l.entryId) : []
	}
	const row = async (id: number) =>
		(await db.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.id, id)))[0]!
	return { owner, who, book: book!, own, card: card!, mira, ola, session: session!, secret, message, host, note, told, ties, hand, reads, row }
}

describe("note-entry-knowledge · where it lands", () => {
	it("1 · Full, own lorebook, was_told: in the lorebook on the session's line, dated, and the judge reads it", async () => {
		const w = await world("full")
		await w.message()
		const [day] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "Day",
				content: "A.",
				fields: { year: 3, month: 2, day: 4 }
			} as never)
			.returning()
		expect(await w.reads()).toEqual([w.secret.id])
		const out = await w.told("r1")
		expect(out).toMatchObject({ route: "book", lorebookId: w.book.id, written: true })
		expect(out.tieId).toBe(out.id)
		const [tie] = await w.ties(w.book.id)
		expect(tie).toMatchObject({ id: out.tieId, knowledgeKind: "was_told", status: "active", toEntryId: w.secret.id })
		const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(tie!.branchId).not.toBeNull()
		expect(tie!.branchId).toBe(session!.lorebookBranchId)
		expect(tie!.historyEntryId).toBe(day!.id)
		expect(await w.ties(w.own.id)).toHaveLength(0)
		expect(await w.reads()).toEqual([])
	})

	it("1b · no dated row and no clock (undatable): the tie hangs on nothing", async () => {
		const w = await world("full")
		await w.message()
		const out = await w.told("r1b")
		expect(out).toMatchObject({ route: "book", lorebookId: w.book.id, written: true })
		const [tie] = await w.ties(w.book.id)
		expect(tie!.historyEntryId).toBeNull()
	})

	it("2 · has_been_there lands the same way", async () => {
		const w = await world("full")
		await w.message()
		const out = await w.told("r2", { params: { knowledgeKind: "has_been_there" } })
		expect((await w.row(out.tieId)).knowledgeKind).toBe("has_been_there")
		expect(await w.reads()).toEqual([])
	})

	it("a seat ref names the member too", async () => {
		const w = await world("full")
		await w.message()
		const out = await w.told("r2b", {}, `character:${w.card.id}`)
		expect((await w.row(out.tieId)).fromNodeId).toBe(w.mira)
	})

	it("3 · a repeat writes nothing and answers with the same id", async () => {
		const w = await world("full")
		await w.message()
		const first = await w.told("r3a")
		const again = await w.told("r3b")
		expect(again).toMatchObject({ written: false, id: first.id, tieId: first.id })
		expect(await w.ties(w.book.id)).toHaveLength(1)
	})

	it("6 · Review changes: the tie is in the session's notes, the lorebook has none, the judge reads it", async () => {
		const w = await world("review")
		await w.message()
		const out = await w.told("r6")
		expect(out).toMatchObject({ route: "own-book", lorebookId: w.own.id, written: true })
		expect(out.notes?.[0]).toBe("Kept in this session's notes; Apply offers it to the lorebook.")
		expect(await w.ties(w.book.id)).toHaveLength(0)
		expect(await w.ties(w.own.id)).toHaveLength(1)
		expect(await w.reads()).toEqual([])
	})

	it("6b · a tie on an entry made in the notes says it goes with that entry", async () => {
		const w = await world("review")
		await w.message()
		const [born] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.own.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "Cellar",
				content: "Damp.",
				fields: { category: "Rooms" }
			} as never)
			.returning()
		const out = await w.told("r6b", {}, w.mira, born!.id)
		expect(out.notes?.[0]).toBe(
			"Kept in this session's notes with Cellar; it goes to the lorebook when Cellar is applied."
		)
	})

	it("6c · a tie for a member who is in the session's cast only says so", async () => {
		const w = await world("review")
		await w.message()
		const only = (
			await insertCastMember(asDb(), { lorebookId: w.own.id, binding: `{{char:Only${n}}}`, name: "Pim" })
		).member!.id
		const out = await w.told("r6c", {}, only)
		expect(out.notes?.[0]).toBe("Kept in this session's notes: Pim is in this session's cast only.")
	})

	it("7 · a lorebook someone else owns: the notes, written for the session's owner", async () => {
		const w = await world("member")
		await w.message()
		const out = await w.told("r7")
		expect(out).toMatchObject({ route: "own-book", lorebookId: w.own.id })
		expect(await w.ties(w.book.id)).toHaveLength(0)
		expect(await w.ties(w.own.id)).toHaveLength(1)
	})
})

describe("note-entry-knowledge · end and the owner's hand", () => {
	it("4 · end: true ends play's tie; a hand tie stays", async () => {
		const w = await world("full")
		await w.message()
		const out = await w.told("r4a")
		const handTie = await w.hand(w.ola, "knows")
		const ended = await w.told("r4b", { params: { end: true } })
		expect(ended.written).toBe(true)
		expect(ended.tieId).toBe(out.tieId)
		expect((await w.row(out.tieId)).status).toBe("resolved")
		expect((await w.row(handTie)).status).toBe("active")
		const again = await w.told("r4c")
		expect(again.written).toBe(true)
		expect(again.id).not.toBe(out.tieId)
	})

	it("4b · a hand tie on the same pair is never ended", async () => {
		const w = await world("full")
		await w.message()
		const handTie = await w.hand(w.mira, "knows")
		const ended = await w.told("r4d", { params: { end: true } })
		expect(ended.written).toBe(false)
		expect((await w.row(handTie)).status).toBe("active")
	})

	it.each(["kept_from", "knows"] as const)("5 · a hand %s tie: nothing written, the receipt says so, the hand tie is unchanged", async (kind) => {
		const w = await world("full")
		await w.message()
		const handTie = await w.hand(w.mira, kind)
		const before = await w.row(handTie)
		const out = await w.told("r5")
		expect(out.written).toBe(false)
		expect(out.notes?.[0]).toContain(`Not noted: ${kind === "knows" ? "Knows" : "Kept from"} is already set for Mira and The Vault`)
		expect(out.tieId).toBeNull()
		expect(await w.ties(w.book.id)).toHaveLength(1)
		expect(await w.row(handTie)).toEqual(before)
	})
})

describe("note-entry-knowledge · refusals", () => {
	it("8 · an entry outside the books the session reads, and a member outside, are refused", async () => {
		const w = await world("full")
		await w.message()
		const [other] = await db.insert(schema.lorebooks).values({ userId: w.owner.id, name: "Elsewhere" }).returning()
		const [far] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: other!.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "Far",
				content: "Far.",
				fields: { category: "Rooms" }
			} as never)
			.returning()
		const stranger = (await insertCastMember(asDb(), { lorebookId: other!.id, binding: `{{char:Far${n}}}`, name: "Far" }))
			.member!.id
		await expect(w.told("r8a", {}, w.mira, far!.id)).rejects.toThrow(/note:/)
		await expect(w.told("r8b", {}, stranger)).rejects.toThrow(/not in this session's lorebook/)
		expect(await w.ties(w.book.id)).toHaveLength(0)
		expect(await w.ties(w.own.id)).toHaveLength(0)
	})

	it("9 · a genre whose lorebook is a reference refuses", async () => {
		const w = await world("reference")
		await w.message()
		const { loreWriteRefusal } = await import("$lib/server/messages/writes")
		const sentence = await loreWriteRefusal(asDb(), w.session.id)
		expect(sentence).toBeTruthy()
		await expect(w.told("r9")).rejects.toThrow(sentence!)
	})

	it("a hand kind passed as the param is refused, and nothing is written", async () => {
		const w = await world("full")
		await w.message()
		await expect(w.told("r9b", { params: { knowledgeKind: "kept_from" } })).rejects.toThrow(
			/notes only 'was_told' or 'has_been_there'/
		)
		expect(await w.ties(w.book.id)).toHaveLength(0)
	})
})

describe.each<Kind>(["full", "review"])("note-entry-knowledge · taken back with the reply · %s", (kind) => {
	it("10 · Back removes a written tie; a swipe too", async () => {
		const w = await world(kind)
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		await w.message()
		const m2 = await w.message()
		const out = await w.told("t10")
		const home = kind === "full" ? w.book.id : w.own.id
		expect(await w.ties(home)).toHaveLength(1)
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(tx as unknown as Db, m2.id, "leaves", { leavingWith: [m2.id] })
		)
		expect(undone.changed).toBe(true)
		expect(await w.ties(home)).toHaveLength(0)
		expect(out.tieId).toBeGreaterThan(0)
		// A second reply's tie, taken by a swipe.
		const m3 = await w.message()
		await w.told("t10b")
		expect(await w.ties(home)).toHaveLength(1)
		const swiped = await retractStateAnchoredTo(asDb(), m3.id, "replaced")
		expect(swiped.changed).toBe(true)
		expect(await w.ties(home)).toHaveLength(0)
	})

	it("11 · Back after end: true restores the ended tie to active", async () => {
		const w = await world(kind)
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		await w.message()
		const out = await w.told("t11a")
		const m2 = await w.message()
		await w.told("t11b", { params: { end: true } })
		expect((await w.row(out.tieId)).status).toBe("resolved")
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(tx as unknown as Db, m2.id, "leaves", { leavingWith: [m2.id] })
		)
		expect(undone.changed).toBe(true)
		expect((await w.row(out.tieId)).status).toBe("active")
	})
})
