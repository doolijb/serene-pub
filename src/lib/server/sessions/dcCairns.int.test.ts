/**
 * ⏳ The `dc-cairns` boot pass (`sessions/dcCairns.ts`, plan
 * `PLAN-history-one-per-date-2026-11-10` item 6).
 *
 * Claims: a cairn matched by the turn's `fate = dead` row (a seat whose name
 * is not the epitaph's) gets a `deceased` version tied to that turn, a
 * `progress.fallen` item and is retyped in place to character lore anchored to
 * the member; matched by name (a removed seat counts); unmatched → world lore
 * "Cairn of ‹name›" and a fallen item with no seat or member; two seats of one
 * name → world lore; a member already deceased gets no second version; a
 * fallen item already there is not doubled; a history row that is not an
 * epitaph, and a cairn of another genre's session, are untouched; a second run
 * changes nothing.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import { dcCairns } from "./dcCairns"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-dcCairns-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const DC = "core:genre/dungeon-crawler"
const db = () => testDb as unknown as Db
let n = 0

async function world(genreId = DC, annex: Record<string, unknown> | null = null) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `dc-cairns-${suffix}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId,
			...(annex ? { annex } : {})
		})
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db(), session!.id)
	const { insertLegacy } = await import("$lib/server/messages/store")
	const message = async (role: "user" | "assistant") =>
		(
			await insertLegacy(db(), {
				sessionId: session!.id,
				role,
				userId: role === "user" ? user.id : null,
				content: `${role} ${++n}`
			} as never)
		).id
	return { user, session: session!, own, message }
}
type World = Awaited<ReturnType<typeof world>>

/** A player seat with a cast member in the session's own book (card-less), or none. */
async function seat(
	w: World,
	name: string,
	opts: { member?: boolean; removed?: boolean } = {}
) {
	const member =
		opts.member === false
			? null
			: (
					await insertCastMember(db(), {
						lorebookId: w.own.id,
						binding: `{{char:${++n}}}`,
						name
					})
				).member
	const [row] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: w.session.id,
			seatName: name,
			castMemberId: member?.id ?? null,
			userId: w.user.id,
			removedAt: opts.removed ? new Date() : null
		})
		.returning()
	return { seat: row!, member }
}

async function cairn(
	w: World,
	opts: { name: string; where?: string; source: number | null; content?: string; typeId?: string }
) {
	const { nextPosition } = await import("$lib/server/utils/lorebookEntries")
	const { entryDeclaration } = await import("$lib/server/entries/declarations")
	const typeId = opts.typeId ?? HISTORY_TYPE_ID
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: w.own.id,
			typeId,
			typeVersion: entryDeclaration(typeId)!.version,
			position: await nextPosition(db(), w.own.id, typeId),
			title: opts.name,
			content:
				opts.content ??
				`Here lies ${opts.name}, Ranger, level 2, who fell` +
					(opts.where ? ` in ${opts.where}` : "") +
					".",
			sourceMessageId: opts.source,
			fields: { year: 1, month: 1, day: 1, isCompleted: false, graphed: false }
		})
		.returning()
	return row!
}

const dead = (w: World, seatId: number, messageId: number) =>
	testDb.insert(schema.attributeValues).values({
		ownerKind: "player_seat",
		ownerId: seatId,
		slotId: "core:slot/fate@1",
		value: { v: "dead" },
		sessionId: w.session.id,
		validFromMessageId: messageId,
		updatedBy: "test"
	})

const entry = async (id: number) =>
	(await testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, id)))[0]!

const annexOf = async (w: World) =>
	(await testDb
		.select({ a: schema.sessions.annex, v: schema.sessions.annexVersions })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, w.session.id)))[0]!

const versionsOf = (memberId: number) =>
	testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))
		.orderBy(asc(schema.characterVersions.id))

const fallenOf = async (w: World) =>
	((await annexOf(w)).a as any)?.core?.["dungeon-crawler-progress"]?.fallen

/** Everything the pass may write, for the second-run comparison. */
async function snapshot(w: World) {
	return {
		entries: await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, w.own.id))
			.orderBy(asc(schema.lorebookEntries.id)),
		versions: await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.lorebookId, w.own.id))
			.orderBy(asc(schema.characterVersions.id)),
		annex: await annexOf(w)
	}
}

describe("dc-cairns", () => {
	test("matched by the turn: version, fallen item, character lore; a second run changes nothing", async () => {
		const w = await world(DC, {
			core: { "dungeon-crawler-progress": { built: true, goal: "Win." }, other: 1 },
			elsewhere: { keep: true }
		})
		await w.message("user")
		const turn = await w.message("assistant")
		await w.message("user")
		// The seat is named otherwise than the epitaph: only the turn can match.
		const { seat: s, member } = await seat(w, "Mira the Bold")
		await seat(w, "Bram")
		await dead(w, s.id, turn)
		const row = await cairn(w, { name: "Mira", where: "The Gate", source: turn })

		const r = await dcCairns(db())
		expect(r).toMatchObject({
			sessions: 1,
			cairns: 1,
			versions: 1,
			alreadyDeceased: 0,
			unanchored: 0,
			fallenAdded: 1,
			characterLore: 1,
			worldLore: 0,
			failed: 0
		})

		const after = await entry(row.id)
		expect(after).toMatchObject({
			id: row.id,
			typeId: CHARACTER_LORE_TYPE_ID,
			anchorBindingId: member!.id,
			title: "Mira",
			content: row.content,
			sourceMessageId: turn
		})
		expect(Object.keys(after.fields as object)).not.toContain("year")

		const versions = await versionsOf(member!.id)
		const written = versions.find((v) => v.writtenBy === "dc-cairns")!
		expect(written).toMatchObject({ nodeState: "deceased", validFromMessageId: turn })
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		expect(
			(await membersAsRead(db(), [member!.id], { sessionId: w.session.id })).get(member!.id)
				?.nodeState
		).toBe("deceased")

		const a = await annexOf(w)
		expect(a.a).toMatchObject({
			core: {
				other: 1,
				"dungeon-crawler-progress": {
					built: true,
					goal: "Win.",
					fallen: [
						{
							name: "Mira",
							where: "The Gate",
							seat: `player-seat:${s.id}`,
							castMemberId: member!.id
						}
					]
				}
			},
			elsewhere: { keep: true }
		})
		expect((a.v as Record<string, number>).core).toBeGreaterThan(0)

		const before = await snapshot(w)
		expect(await dcCairns(db())).toMatchObject({ sessions: 0, cairns: 0 })
		expect(await snapshot(w)).toEqual(before)
	})

	test("matched by name, a removed seat included; the version is tied to the cairn's older turn", async () => {
		const w = await world()
		const old = await w.message("assistant")
		await w.message("user")
		await w.message("assistant")
		const { seat: s, member } = await seat(w, "Ilsa", { removed: true })
		const row = await cairn(w, { name: "ilsa", source: old })

		await dcCairns(db())
		expect((await entry(row.id)).anchorBindingId).toBe(member!.id)
		expect(
			(await versionsOf(member!.id)).find((v) => v.writtenBy === "dc-cairns")
		).toMatchObject({ nodeState: "deceased", validFromMessageId: old })
		expect(await fallenOf(w)).toEqual([
			{ name: "ilsa", where: "", seat: `player-seat:${s.id}`, castMemberId: member!.id }
		])
	})

	test("unmatched: world lore 'Cairn of ‹name›' and a fallen item with no seat or member", async () => {
		const w = await world()
		const turn = await w.message("assistant")
		await seat(w, "Someone else")
		const row = await cairn(w, { name: "Ghost", where: "The Well", source: turn })

		const r = await dcCairns(db())
		expect(r).toMatchObject({ worldLore: 1, characterLore: 0, versions: 0, fallenAdded: 1 })
		expect(await entry(row.id)).toMatchObject({
			typeId: WORLD_LORE_TYPE_ID,
			title: "Cairn of Ghost",
			anchorBindingId: null,
			sourceMessageId: turn,
			content: row.content
		})
		expect(await fallenOf(w)).toEqual([
			{ name: "Ghost", where: "The Well", seat: null, castMemberId: null }
		])
	})

	test("ambiguous: two seats of one name and no turn match is world lore", async () => {
		const w = await world()
		const turn = await w.message("assistant")
		const a = await seat(w, "Twin")
		await seat(w, "twin")
		const row = await cairn(w, { name: "Twin", source: turn })

		await dcCairns(db())
		expect((await entry(row.id)).typeId).toBe(WORLD_LORE_TYPE_ID)
		expect(await versionsOf(a.member!.id)).toHaveLength(1)
		expect((await fallenOf(w))[0]).toMatchObject({ seat: null, castMemberId: null })
	})

	test("a member already deceased gets no second version; a fallen item already there is not doubled", async () => {
		const w = await world(DC, {
			core: { "dungeon-crawler-progress": { fallen: [] } }
		})
		const turn = await w.message("assistant")
		const { seat: s, member } = await seat(w, "Odo")
		const row = await cairn(w, { name: "Odo", source: turn })
		// The death flow already did its part.
		const { writeCastVersion } = await import("$lib/server/characters/versions")
		await testDb.transaction((tx) =>
			writeCastVersion(tx as unknown as Db, {
				member: member!.id,
				changes: { nodeState: "deceased" },
				writtenBy: "run:test",
				session: { id: w.session.id, messageId: turn, ownAnchor: true }
			})
		)
		const item = {
			name: "Odo",
			where: "",
			seat: `player-seat:${s.id}`,
			castMemberId: member!.id
		}
		await testDb
			.update(schema.sessions)
			.set({
				annex: { core: { "dungeon-crawler-progress": { fallen: [item] } } }
			})
			.where(eq(schema.sessions.id, w.session.id))
		const versionsBefore = (await versionsOf(member!.id)).length

		const r = await dcCairns(db())
		expect(r).toMatchObject({ versions: 0, alreadyDeceased: 1, fallenAdded: 0, characterLore: 1 })
		expect(await versionsOf(member!.id)).toHaveLength(versionsBefore)
		expect(await fallenOf(w)).toEqual([item])
		expect((await entry(row.id)).typeId).toBe(CHARACTER_LORE_TYPE_ID)
	})

	test("a cairn with no live turn writes no version but still files and retypes", async () => {
		const w = await world()
		const { member } = await seat(w, "Pell")
		const row = await cairn(w, { name: "Pell", source: null })

		const r = await dcCairns(db())
		expect(r).toMatchObject({ versions: 0, unanchored: 1, fallenAdded: 1, characterLore: 1 })
		expect((await versionsOf(member!.id)).filter((v) => v.writtenBy === "dc-cairns")).toHaveLength(0)
		expect((await entry(row.id)).anchorBindingId).toBe(member!.id)
	})

	test("untouched: a history row that is not an epitaph, and another genre's cairn", async () => {
		const w = await world()
		const other = await world("core:genre/story")
		const note = await cairn(w, {
			name: "The founding",
			source: null,
			content: "The founding of the hall."
		})
		const strange = await cairn(w, {
			name: "Mira",
			source: null,
			content: "Here lies Mira, who fell."
		})
		const foreign = await cairn(other, { name: "Mira", source: null })
		const before = {
			note: await entry(note.id),
			strange: await entry(strange.id),
			foreign: await entry(foreign.id)
		}

		const r = await dcCairns(db())
		expect(r.cairns).toBe(0)
		expect(await entry(note.id)).toEqual(before.note)
		expect(await entry(strange.id)).toEqual(before.strange)
		expect(await entry(foreign.id)).toEqual(before.foreign)
	})
})
