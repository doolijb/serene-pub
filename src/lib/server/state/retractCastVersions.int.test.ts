/**
 * 🚧 Back, a swipe, Forward and a message delete take and restore the cast
 * versions a session's story write anchored to the message (plan §32 §7, as
 * amended by §33.2): a row some branch still reads is **retired**, never
 * deleted; any other row is taken; Forward puts the row back with its id and
 * write order and clears the mark; `sweepRetiredVersions` removes the retired
 * rows nobody reads once the last branch is gone.
 *
 * Branches are built by hand: a child session with `branch_ancestry` and
 * copies of the parent's messages up to the fork, each naming its origin.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, max } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import {
	insertCard,
	insertCastMember,
	retireOrTakeVersions,
	sweepRetiredVersions,
	writeCastVersion,
	type CastVersionChanges
} from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cv-time-retract-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const GENRE = "test:genre/cv-time-retract"
let n = 0
const db = () => testDb as unknown as Db

async function world() {
	_clearAttributeSlots()
	genreKeeping(GENRE, {
		name: { en: "Retract cast versions" },
		family: "test",
		slots: [],
		events: {}
	})
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `cvt-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Card ${suffix}`,
		description: "The card's description."
	})
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: card.id,
		name: `Ada ${suffix}`
	})
	const session = await newSession(user.id, {
		lorebookId: book!.id,
		storyClockYear: 5,
		storyClockMonth: 1,
		storyClockDay: 1,
		storyClockHour: 9,
		storyClockMinute: 30
	})
	return { user, book: book!, member, base: base!, session }
}
type World = Awaited<ReturnType<typeof world>>

async function newSession(
	userId: number,
	extra: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			genreId: GENRE,
			...extra
		})
		.returning()
	return row!
}

/** A live line of the session, written through the message store (both worlds). */
async function line(
	sessionId: number,
	userId: number,
	role: "user" | "assistant",
	origin?: { sessionId: number; messageId: number }
): Promise<number> {
	const { insertLegacy } = await import("$lib/server/messages/store")
	const row = await insertLegacy(db(), {
		sessionId,
		role,
		userId: role === "user" ? userId : null,
		content: `${role} line ${++n}`,
		...(origin
			? {
					originSessionId: origin.sessionId,
					originMessageId: origin.messageId
				}
			: {})
	} as any)
	return row.id
}

/** A parent session holding a person's line and a reply; the reply `anchor` is the newest. */
async function played(w: World) {
	const first = await line(w.session.id, w.user.id, "user")
	const anchor = await line(w.session.id, w.user.id, "assistant")
	return { first, anchor }
}

const storyWrite = (w: World, changes: CastVersionChanges) =>
	testDb.transaction((tx) =>
		writeCastVersion(tx as unknown as Db, {
			member: w.member.id,
			changes,
			writtenBy: `run:${w.session.id}`,
			session: { id: w.session.id }
		})
	)

/** The highest write order there is: what a fork taken now marks. */
async function markNow(): Promise<number> {
	const [row] = await testDb
		.select({ top: max(schema.characterVersions.writeOrder) })
		.from(schema.characterVersions)
	return row!.top!
}

/** A branch of the world's session, forked now, holding copies of `copied` parent messages. */
async function branchOf(w: World, copied: readonly number[]) {
	const branch = await newSession(w.user.id, {
		lorebookId: w.book.id,
		branchAncestry: [{ sessionId: w.session.id, mark: await markNow() }],
		storyClockYear: 5,
		storyClockMonth: 1,
		storyClockDay: 1
	})
	for (const id of copied)
		await line(branch.id, w.user.id, "assistant", {
			sessionId: w.session.id,
			messageId: id
		})
	return branch
}

async function readBy(w: World, sessionId: number) {
	const { castVersionsInForce } = await import(
		"$lib/server/cast/memberAsRead"
	)
	return (await castVersionsInForce(db(), [w.member.id], { sessionId })).get(
		w.member.id
	)!.version
}

const versionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, id))
	)[0]

const retract = async (
	messageId: number,
	opts: Parameters<typeof import("./write").retractStateAnchoredTo>[2]
) => (await import("./write")).retractStateAnchoredTo(db(), messageId, opts)

describe("Back and Forward", () => {
	test("Back takes a cast version, Forward brings it back with its id and write order", async () => {
		const w = await world()
		const { anchor } = await played(w)
		const { version } = await storyWrite(w, {
			summary: "Wrote at the turn."
		})
		expect(version.sourceMessageId).toBe(anchor)
		expect((await readBy(w, w.session.id)).id).toBe(version.id)

		// Through the real handlers: the unit is the person's line and the reply.
		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const back = await rewindTurn(db(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(back).toMatchObject({ ok: true })
		expect(await versionRow(version.id)).toBeUndefined()
		expect((await readBy(w, w.session.id)).id).toBe(w.base.id)

		const ahead = await forwardTurn(db(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(ahead).toMatchObject({ ok: true })
		const restored = await versionRow(version.id)
		expect(restored).toBeDefined()
		expect(restored!.writeOrder).toBe(version.writeOrder)
		expect(restored!.summary).toBe("Wrote at the turn.")
		expect(restored!.sourceMessageId).toBe(anchor)
		expect(restored!.validFromMessageId).toBe(anchor)
		expect(restored!.retiredOrder).toBeNull()
		expect((await readBy(w, w.session.id)).id).toBe(version.id)
	})

	test("the record survives the JSON of the rewound row", async () => {
		const w = await world()
		const { anchor } = await played(w)
		const { version } = await storyWrite(w, { summary: "Round trip." })
		const out = await retract(anchor, "leaves")
		expect(out.changed).toBe(true)
		expect(out.taken.castVersions?.map((v) => v.id)).toEqual([version.id])
		const { reviveRetractedState, restoreRetractedState } = await import(
			"./write"
		)
		const revived = reviveRetractedState(
			JSON.parse(JSON.stringify(out.taken))
		)!
		expect(revived.castVersions![0]!.createdAt).toBeInstanceOf(Date)
		await restoreRetractedState(db(), revived)
		expect((await versionRow(version.id))!.writeOrder).toBe(
			version.writeOrder
		)
		// A record written before cast versions has none.
		expect(
			reviveRetractedState({ messageId: anchor })!.castVersions
		).toEqual([])
	})

	test("a branch that reads the version keeps it: Back retires it, Forward clears the mark", async () => {
		const w = await world()
		const { first, anchor } = await played(w)
		const { version } = await storyWrite(w, { summary: "Before the fork." })
		const branch = await branchOf(w, [first, anchor])
		expect((await readBy(w, branch.id)).id).toBe(version.id)

		const out = await retract(anchor, "leaves")
		const kept = await versionRow(version.id)
		expect(kept!.retiredOrder).not.toBeNull()
		expect(kept!.retiredOrder!).toBeGreaterThan(version.writeOrder)
		// The record holds it as it was, unmarked.
		expect(out.taken.castVersions).toHaveLength(1)
		expect(out.taken.castVersions![0]!.retiredOrder).toBeNull()
		expect((await readBy(w, branch.id)).id).toBe(version.id)
		expect((await readBy(w, w.session.id)).id).toBe(w.base.id)

		const { restoreRetractedState } = await import("./write")
		await restoreRetractedState(db(), out.taken)
		expect((await versionRow(version.id))!.retiredOrder).toBeNull()
		expect((await readBy(w, w.session.id)).id).toBe(version.id)
		expect((await readBy(w, branch.id)).id).toBe(version.id)
	})

	test("a branch forked before the message does not keep it: Back deletes it outright", async () => {
		const w = await world()
		const { first, anchor } = await played(w)
		const { version } = await storyWrite(w, { summary: "After the fork." })
		const branch = await branchOf(w, [first])
		expect((await readBy(w, branch.id)).id).toBe(w.base.id)

		await retract(anchor, "leaves")
		expect(await versionRow(version.id)).toBeUndefined()
	})
})

describe("a swipe of the fork message", () => {
	test("the row is retired, the new write is the parent's, the branch keeps the old; a failed replacement puts it back", async () => {
		const w = await world()
		const { first, anchor } = await played(w)
		const { version: v } = await storyWrite(w, {
			summary: "First telling."
		})
		const branch = await branchOf(w, [first, anchor])

		const swiped = await retract(anchor, "replaced")
		expect((await versionRow(v.id))!.retiredOrder).not.toBeNull()

		const { version: v2 } = await storyWrite(w, {
			summary: "Second telling."
		})
		expect(v2.id).not.toBe(v.id)
		expect(v2.sourceMessageId).toBe(anchor)
		expect(v2.writeOrder).toBeGreaterThan(branch.branchAncestry![0]!.mark)
		expect((await readBy(w, w.session.id)).id).toBe(v2.id)
		expect((await readBy(w, branch.id)).id).toBe(v.id)

		// The replacement failed: the swipe is undone.
		const { restoreRetractedState } = await import("./write")
		await restoreRetractedState(db(), swiped.taken)
		expect(await versionRow(v2.id)).toBeUndefined()
		expect((await versionRow(v.id))!.retiredOrder).toBeNull()
		expect((await readBy(w, w.session.id)).id).toBe(v.id)
		expect((await readBy(w, branch.id)).id).toBe(v.id)
	})
})

describe("a delete of an anchored message", () => {
	test("with no branch the version goes with it, not left behind", async () => {
		const w = await world()
		const { anchor } = await played(w)
		const { version } = await storyWrite(w, { summary: "Goes with it." })
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await deleteLegacy(db(), anchor)
		expect(await versionRow(version.id)).toBeUndefined()
		expect((await readBy(w, w.session.id)).id).toBe(w.base.id)
	})

	test("a branch that reads it keeps it, retired", async () => {
		const w = await world()
		const { first, anchor } = await played(w)
		const { version } = await storyWrite(w, {
			summary: "Read by a branch."
		})
		const branch = await branchOf(w, [first, anchor])
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await deleteLegacy(db(), anchor)
		const kept = await versionRow(version.id)
		expect(kept).toBeDefined()
		expect(kept!.retiredOrder).not.toBeNull()
		expect((await readBy(w, branch.id)).id).toBe(version.id)
		expect((await readBy(w, w.session.id)).id).toBe(w.base.id)
	})
})

describe("retireOrTakeVersions", () => {
	test("answers the rows as they were, skips a row with no source", async () => {
		const w = await world()
		const { first, anchor } = await played(w)
		const { version } = await storyWrite(w, { summary: "Read." })
		await branchOf(w, [first, anchor])
		const out = await testDb.transaction((tx) =>
			retireOrTakeVersions(tx as unknown as Db, [version, w.base])
		)
		expect(out.taken).toEqual([])
		expect(out.retired).toHaveLength(1)
		expect(out.retired[0]).toMatchObject({
			id: version.id,
			retiredOrder: null
		})
		expect((await versionRow(version.id))!.retiredOrder).not.toBeNull()
		// The author's base is neither taken nor marked.
		expect((await versionRow(w.base.id))!.retiredOrder).toBeNull()
	})
})

describe("sweepRetiredVersions", () => {
	async function retiredByBack() {
		const w = await world()
		const { first, anchor } = await played(w)
		const { version } = await storyWrite(w, { summary: "Retired." })
		const branch = await branchOf(w, [first, anchor])
		await retract(anchor, "leaves")
		expect((await versionRow(version.id))!.retiredOrder).not.toBeNull()
		return { w, first, anchor, version, branch }
	}

	test("the last branch going sweeps the row", async () => {
		const { w, version, branch } = await retiredByBack()
		// A branch still there: nothing to sweep.
		expect(await sweepRetiredVersions(db(), [w.session.id])).toBe(0)
		expect(await versionRow(version.id)).toBeDefined()
		await testDb
			.delete(schema.sessions)
			.where(eq(schema.sessions.id, branch.id))
		expect(await sweepRetiredVersions(db(), [w.session.id])).toBe(1)
		expect(await versionRow(version.id)).toBeUndefined()
	})

	test("a second live branch that reads the row keeps it", async () => {
		const { w, first, anchor, version, branch } = await retiredByBack()
		// The second branch forks before the Back, so it too reads the row:
		// build it as one that copied the lines when the row was live.
		const second = await newSession(w.user.id, {
			lorebookId: w.book.id,
			branchAncestry: [
				{ sessionId: w.session.id, mark: version.writeOrder }
			],
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 1
		})
		for (const id of [first, anchor])
			await line(second.id, w.user.id, "assistant", {
				sessionId: w.session.id,
				messageId: id
			})
		expect((await readBy(w, second.id)).id).toBe(version.id)
		await testDb
			.delete(schema.sessions)
			.where(eq(schema.sessions.id, branch.id))
		expect(await sweepRetiredVersions(db(), [w.session.id])).toBe(0)
		expect(await versionRow(version.id)).toBeDefined()
		await testDb
			.delete(schema.sessions)
			.where(eq(schema.sessions.id, second.id))
		expect(await sweepRetiredVersions(db(), [w.session.id])).toBe(1)
	})

	test("deleting the last branch through sessions:delete sweeps the row", async () => {
		const { w, version, branch } = await retiredByBack()
		const { sessionsDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsDeleteHandler.handler(
			{
				user: { id: w.user.id },
				io: { to: () => ({ emit: () => {} }) }
			} as any,
			{ id: branch.id } as any,
			() => {}
		)
		expect(await versionRow(version.id)).toBeUndefined()
		// The parent reads the base, as it did after its Back.
		expect((await readBy(w, w.session.id)).id).not.toBe(version.id)
	})
})
